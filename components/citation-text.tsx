"use client";

import { Fragment } from "react";

interface Props {
  text: string;
  onHoverMarker: (marker: string | null) => void;
  onSelectMarker: (marker: string) => void;
}

export function CitationText({ text, onHoverMarker, onSelectMarker }: Props) {
  const parts = text.split(/(\[C\d+\])/g);

  return (
    <p className="whitespace-pre-wrap text-[15px] leading-[1.75] text-foreground">
      {parts.map((part, index) => {
        const match = /^\[C(\d+)\]$/.exec(part);
        if (!match) return <Fragment key={index}>{part}</Fragment>;
        const marker = `C${match[1]}`;
        return (
          <button
            key={index}
            type="button"
            onMouseEnter={() => onHoverMarker(marker)}
            onMouseLeave={() => onHoverMarker(null)}
            onClick={() => onSelectMarker(marker)}
            className="numeric mx-[2px] inline-flex h-[18px] min-w-[22px] translate-y-[-1px] items-center justify-center rounded-[3px] border border-border bg-secondary px-1 align-middle text-[11px] font-medium text-marker transition-colors hover:bg-accent"
          >
            {marker}
          </button>
        );
      })}
    </p>
  );
}
