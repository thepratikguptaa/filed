import { createHash } from "node:crypto";
import { getEncoding } from "js-tiktoken";
import { chunking } from "../config";
import type { Block, ChunkInput, FilingRef, Section } from "../types";

const encoder = getEncoding("cl100k_base");

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

function expandBlocks(blocks: Block[]): Block[] {
  const expanded: Block[] = [];
  for (const block of blocks) {
    if (block.kind === "table") {
      expanded.push(block);
      continue;
    }
    if (countTokens(block.text) <= chunking.maxTokens) {
      expanded.push(block);
      continue;
    }
    for (const part of splitOversizedText(block.text, chunking.targetTokens)) {
      expanded.push({ kind: "text", text: part });
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

export function chunkFiling(filing: FilingRef, sections: Section[]): ChunkInput[] {
  const chunks: ChunkInput[] = [];
  let position = 0;

  for (const section of sections) {
    const blocks = expandBlocks(section.blocks);
    let buffer: Block[] = [];
    let tokens = 0;
    let carried = 0;

    const flush = () => {
      if (buffer.length === 0 || buffer.length === carried) return;
      const text = render(buffer);
      const tokenCount = countTokens(text);
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
      const carry = overlapFrom(buffer);
      buffer = [...carry];
      carried = carry.length;
      tokens = carry.reduce((total, block) => total + countTokens(block.text), 0);
    };

    for (const block of blocks) {
      const size = countTokens(block.text);
      if (tokens > 0 && tokens + size > chunking.targetTokens) flush();
      buffer.push(block);
      tokens += size;
      if (tokens >= chunking.targetTokens) flush();
    }
    flush();
  }

  return chunks;
}
