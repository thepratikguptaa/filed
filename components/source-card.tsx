"use client";

import { motion } from "motion/react";
import { useState } from "react";
import type { AnswerCitation } from "@/lib/answer";
import type { Chunk } from "@/lib/types";

import { getCompanyFullName } from "@/lib/companies";

interface Props {
  citation: AnswerCitation;
  chunk: Chunk;
  cited: boolean;
  highlighted: boolean;
  index: number;
}

export function SourceCard({ citation, chunk, cited, highlighted, index }: Props) {
  const [open, setOpen] = useState(false);
  const body = chunk.text.replace(/\s+/g, " ");
  const companyName = getCompanyFullName(citation.ticker, chunk.company || citation.company);

  return (
    <motion.li
      id={`source-${citation.marker}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.3), ease: "easeOut" }}
      className={`border-b border-border px-5 py-4 transition-colors last:border-b-0 ${
        highlighted ? "bg-accent" : "bg-transparent"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2.5">
          <span className="numeric text-[11px] font-medium text-marker">{citation.marker}</span>
          <span className="text-[13px] font-medium text-foreground" title={citation.ticker}>{companyName}</span>
          <span className="numeric text-[12px] text-muted-foreground">FY{citation.fiscalYear}</span>
          <span className="text-[12px] text-muted-foreground">{citation.section ?? "front matter"}</span>
        </div>
        <div className="flex items-center gap-2.5">
          {cited && (
            <span className="text-[10px] uppercase tracking-[0.09em] text-marker">cited</span>
          )}
          <span className="numeric text-[11px] text-muted-foreground">
            {citation.score?.toFixed(3)}
          </span>
        </div>
      </div>

      <p className={`mt-2 text-[13px] leading-[1.65] text-muted-foreground ${open ? "" : "line-clamp-3"}`}>
        {body}
      </p>

      <div className="mt-2 flex items-center gap-4">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="text-[11px] uppercase tracking-[0.09em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          {open ? "collapse" : "expand"}
        </button>
        {citation.sourceUrl && (
          <a
            href={citation.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] uppercase tracking-[0.09em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline inline-flex items-center gap-1"
          >
            SEC filing ↗
          </a>
        )}
      </div>
    </motion.li>
  );
}
