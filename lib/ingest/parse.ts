import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { Block, ParsedFiling, Section } from "../types";

const BLOCK_TAGS = new Set([
  "p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6",
  "section", "article", "blockquote", "ul", "ol", "dd", "dt", "td", "th", "br",
]);

const ITEM_HEADING = /^item\s+(\d{1,2}[A-Ca-c]?)\s*[.:—-]?\s*(.{0,120})$/i;

const ITEM_TITLES: Record<string, string> = {
  "1": "Business",
  "1A": "Risk Factors",
  "1B": "Unresolved Staff Comments",
  "1C": "Cybersecurity",
  "2": "Properties",
  "3": "Legal Proceedings",
  "4": "Mine Safety Disclosures",
  "5": "Market for Registrant's Common Equity",
  "6": "Selected Financial Data",
  "7": "Management's Discussion and Analysis",
  "7A": "Quantitative and Qualitative Disclosures About Market Risk",
  "8": "Financial Statements and Supplementary Data",
  "9": "Changes in and Disagreements with Accountants",
  "9A": "Controls and Procedures",
  "9B": "Other Information",
  "10": "Directors, Executive Officers and Corporate Governance",
  "11": "Executive Compensation",
  "12": "Security Ownership of Certain Beneficial Owners",
  "13": "Certain Relationships and Related Transactions",
  "14": "Principal Accountant Fees and Services",
  "15": "Exhibits and Financial Statement Schedules",
  "16": "Form 10-K Summary",
};

function clean(value: string): string {
  return value.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

function isBlock(node: AnyNode): node is Element {
  return node.type === "tag" && BLOCK_TAGS.has(node.tagName);
}

function hasBlockDescendant($: cheerio.CheerioAPI, element: Element): boolean {
  return $(element).find([...BLOCK_TAGS].join(",")).length > 0;
}

const ADORNMENT = /^(\$|%|\)|\(|—|–|-|\*|†|‡|(\([a-z]{1,3}\))+)$/i;

function mergeAdornments(cells: string[]): string[] {
  const merged: string[] = [];
  for (const cell of cells) {
    if (merged.length > 0 && ADORNMENT.test(cell)) {
      const previous = merged[merged.length - 1];
      merged[merged.length - 1] = cell === "$" ? `${cell}${previous}` : `${previous}${cell}`;
      continue;
    }
    merged.push(cell);
  }
  return merged;
}

function tableToText($: cheerio.CheerioAPI, table: Element): string | null {
  const rows: string[] = [];
  $(table)
    .find("tr")
    .each((_, tr) => {
      const cells: string[] = [];
      $(tr)
        .find("td,th")
        .each((__, cell) => {
          cells.push(clean($(cell).text()));
        });
      const filled = mergeAdornments(cells.filter((cell) => cell.length > 0));
      if (filled.length > 0) rows.push(filled.join(" | "));
    });
  if (rows.length === 0) return null;
  const looksTabular = rows.length >= 2 && rows.some((row) => row.includes(" | "));
  if (!looksTabular) return rows.join(" ") || null;
  return rows.join("\n");
}

function collectBlocks($: cheerio.CheerioAPI, node: AnyNode, out: Block[]): void {
  const children = "children" in node ? (node.children as AnyNode[]) : [];
  for (const child of children) {
    if (child.type !== "tag") continue;
    const tag = child.tagName;
    if (tag === "table") {
      if ($(child).find("table").length > 0) {
        collectBlocks($, child, out);
        continue;
      }
      const text = tableToText($, child);
      if (text) out.push({ kind: text.includes("\n") ? "table" : "text", text });
      continue;
    }
    if (isBlock(child) && !hasBlockDescendant($, child)) {
      const text = clean($(child).text());
      if (text) out.push({ kind: "text", text });
      continue;
    }
    collectBlocks($, child, out);
  }
}

function headingFor(block: Block): { item: string; title: string } | null {
  if (block.kind !== "text" || block.text.length > 140) return null;
  const match = ITEM_HEADING.exec(block.text);
  if (!match) return null;
  const item = match[1].toUpperCase();
  if (!(item in ITEM_TITLES)) return null;
  const trailing = clean(match[2]).replace(/\.+$/, "");
  return { item, title: trailing.length > 3 ? trailing : ITEM_TITLES[item] };
}

function mergeShortText(blocks: Block[]): Block[] {
  const merged: Block[] = [];
  let previousWasHeading = false;

  for (const block of blocks) {
    const isHeading = headingFor(block) !== null;
    const previous = merged[merged.length - 1];
    if (
      !isHeading &&
      !previousWasHeading &&
      block.kind === "text" &&
      previous?.kind === "text" &&
      previous.text.length < 400
    ) {
      previous.text = `${previous.text} ${block.text}`;
    } else {
      merged.push({ ...block });
    }
    previousWasHeading = isHeading;
  }
  return merged;
}

function sizeOf(blocks: Block[]): number {
  return blocks.reduce((total, block) => total + block.text.length, 0);
}

const INCORPORATED_SECTION_CHARS = 200_000;

export const PARSER_VERSION = 3;

const MDA_CAPTION = /management[''’]s discussion and analysis/i;
const AUDIT_CAPTION = /report of independent registered public accounting firm/i;
const NOTES_CAPTION = /notes to consolidated financial statements|consolidated statements of (income|operations|cash flows)/i;

function firstMatch(blocks: Block[], pattern: RegExp, from = 0): number {
  for (let i = from; i < blocks.length; i += 1) {
    if (blocks[i].kind === "text" && pattern.test(blocks[i].text)) return i;
  }
  return -1;
}

function lastMatch(blocks: Block[], pattern: RegExp): number {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (blocks[i].kind === "text" && pattern.test(blocks[i].text)) return i;
  }
  return -1;
}

function splitIncorporatedReport(section: Section): Section[] {
  const { blocks } = section;
  const mda = firstMatch(blocks, MDA_CAPTION);
  const audit = firstMatch(blocks, AUDIT_CAPTION, mda < 0 ? 0 : mda);
  const notesEnd = lastMatch(blocks, NOTES_CAPTION);
  if (mda < 0 || audit <= mda || notesEnd < audit) return [section];

  const parts: Section[] = [];
  const push = (item: string | null, title: string, slice: Block[]) => {
    if (slice.length > 0) parts.push({ item, title, blocks: slice });
  };

  push(section.item, section.title, blocks.slice(0, mda));
  push("Item 7", "Management's Discussion and Analysis", blocks.slice(mda, audit));
  push("Item 8", "Financial Statements and Supplementary Data", blocks.slice(audit, notesEnd + 1));
  push(section.item, section.title, blocks.slice(notesEnd + 1));
  return parts;
}

export function parseFiling(html: string): ParsedFiling {
  const $ = cheerio.load(html);
  $("script, style, ix\\:header, [style*='display:none'], [style*='display: none']").remove();

  const blocks: Block[] = [];
  const body = $("body").get(0);
  collectBlocks($, body ?? $.root().get(0)!, blocks);
  const normalized = mergeShortText(blocks);

  const sections: Section[] = [];
  let current: Section = { item: null, title: "Front Matter", blocks: [] };

  for (const block of normalized) {
    const heading = headingFor(block);
    if (heading) {
      sections.push(current);
      current = { item: `Item ${heading.item}`, title: heading.title, blocks: [] };
      continue;
    }
    current.blocks.push(block);
  }
  sections.push(current);

  const substantial = sections.filter((section, index) => {
    if (index === 0) return sizeOf(section.blocks) > 2000;
    return sizeOf(section.blocks) > 500;
  });

  const deduped: Section[] = [];
  for (const section of substantial) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.item === section.item) {
      previous.blocks.push(...section.blocks);
      continue;
    }
    deduped.push(section);
  }

  const expanded = deduped.flatMap((section) =>
    sizeOf(section.blocks) > INCORPORATED_SECTION_CHARS ? splitIncorporatedReport(section) : [section],
  );

  const text = normalized.map((block) => block.text).join("\n");
  return { sections: expanded, contentHash: createHash("sha256").update(text).digest("hex") };
}
