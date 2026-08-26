import { createHash } from "node:crypto";
import { getEncoding } from "js-tiktoken";
import { chunking, HEADER_BUDGET } from "../config";
import type { Block, ChunkInput, FilingRef, Section } from "../types";

const encoder = getEncoding("cl100k_base");
const SEPARATOR_SLACK = 16;

export function countTokens(text: string): number {
  return encoder.encode(text).length;
}

function splitOversizedText(text: string, limit: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|\S+$/g) ?? [text];
  const parts: string[] = [];
  let buffer = "";

  for (const sentence of sentences) {
    const candidate = buffer ? `${buffer}${sentence}` : sentence;
    if (countTokens(candidate) > limit && buffer) {
      parts.push(buffer.trim());
      buffer = sentence;
    } else {
      buffer = candidate;
    }
  }
  if (buffer.trim()) parts.push(buffer.trim());
  return parts;
}

function splitOversizedTable(text: string, limit: number): string[] {
  const rows = text.split("\n");
  const header = rows[0];
  const headerTokens = countTokens(header);
  const parts: string[] = [];
  let buffer: string[] = [];
  let tokens = 0;

  for (const row of rows) {
    const size = countTokens(row);
    if (buffer.length > 0 && tokens + size > limit) {
      parts.push(buffer.join("\n"));
      buffer = parts.length > 0 && header !== buffer[0] ? [header] : [];
      tokens = buffer.length > 0 ? headerTokens : 0;
    }
    buffer.push(row);
    tokens += size;
  }
  if (buffer.length > 0) parts.push(buffer.join("\n"));
  return parts;
}

function hardSplit(text: string, limit: number): string[] {
  const ids = encoder.encode(text);
  const parts: string[] = [];
  for (let i = 0; i < ids.length; i += limit) {
    parts.push(encoder.decode(ids.slice(i, i + limit)));
  }
  return parts;
}

function expandBlocks(blocks: Block[]): Block[] {
  const limit = chunking.maxTokens - HEADER_BUDGET - chunking.overlapTokens - SEPARATOR_SLACK;
  const expanded: Block[] = [];

  for (const block of blocks) {
    if (countTokens(block.text) <= limit) {
      expanded.push(block);
      continue;
    }
    const parts =
      block.kind === "table"
        ? splitOversizedTable(block.text, limit)
        : splitOversizedText(block.text, limit);

    for (const part of parts) {
      const pieces = countTokens(part) > limit ? hardSplit(part, limit) : [part];
      for (const piece of pieces) expanded.push({ kind: block.kind, text: piece });
    }
  }
  return expanded;
}

function overlapFrom(blocks: Block[]): Block[] {
  const tail: Block[] = [];
  let tokens = 0;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (block.kind === "table") break;
    const size = countTokens(block.text);
    if (tokens + size > chunking.overlapTokens) break;
    tail.unshift(block);
    tokens += size;
  }
  return tail;
}

function render(blocks: Block[]): string {
  return blocks.map((block) => block.text).join("\n\n");
}

const CAPTION_HINT = /^(the following|this table|summary of|components of|selected|consolidated|changes in)/i;

function isCaption(block: Block): boolean {
  return block.kind === "text" && block.text.length < 220 && CAPTION_HINT.test(block.text);
}

function buildHeader(filing: FilingRef, section: Section, caption: string | null): string {
  const where = section.item ? `${section.item} ${section.title}` : "front matter";
  const base = `${filing.company} (${filing.ticker}) FY${filing.fiscalYear} ${filing.filingType} · ${where}`;
  if (!caption) return base;

  const room = HEADER_BUDGET - countTokens(base) - 4;
  if (room <= 4) return base;

  let text = "";
  for (const word of caption.replace(/\s+/g, " ").trim().split(" ")) {
    const next = text ? `${text} ${word}` : word;
    if (countTokens(next) > room) break;
    text = next;
  }
  return text ? `${base} · ${text}` : base;
}

export function chunkFiling(filing: FilingRef, sections: Section[]): ChunkInput[] {
  const chunks: ChunkInput[] = [];
  let position = 0;

  for (const section of sections) {
    const blocks = expandBlocks(section.blocks);
    let buffer: Block[] = [];
    let tokens = 0;
    let carried = 0;
    let caption: string | null = null;

    const flush = () => {
      if (buffer.length === 0 || buffer.length === carried) return;
      const body = render(buffer);
      const header = buildHeader(filing, section, buffer.some((b) => b.kind === "table") ? caption : null);
      const text = `${header}\n\n${body}`;
      const tokenCount = countTokens(text);
      if (tokenCount > chunking.maxTokens) {
        throw new Error(
          `Chunk of ${tokenCount} tokens exceeds the ${chunking.maxTokens} limit and would be truncated by the model`,
        );
      }
      if (tokenCount >= chunking.minTokens) {
        const documentId = filing.accessionNumber.replace(/-/g, "");
        chunks.push({
          id: `${documentId}#${String(position).padStart(4, "0")}`,
          documentId,
          company: filing.company,
          ticker: filing.ticker,
          filingType: filing.filingType,
          fiscalYear: filing.fiscalYear,
          section: section.item,
          sectionTitle: section.title,
          position,
          text,
          tokenCount,
          contentHash: createHash("sha256").update(text).digest("hex"),
          hasTable: buffer.some((block) => block.kind === "table"),
        });
        position += 1;
      }
      caption = null;
      const carry = overlapFrom(buffer);
      buffer = [...carry];
      carried = carry.length;
      tokens = carry.reduce((total, block) => total + countTokens(block.text), 0);
    };

    for (const block of blocks) {
      const size = countTokens(block.text);
      if (tokens > 0 && tokens + size > chunking.targetTokens) flush();
      if (isCaption(block)) caption = block.text;
      buffer.push(block);
      tokens += size;
      if (tokens >= chunking.targetTokens) flush();
    }
    flush();
  }

  return chunks;
}
