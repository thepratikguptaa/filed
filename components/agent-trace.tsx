"use client";

import { motion } from "motion/react";
import type { AgentStep, AgentTrace } from "@/lib/agent/types";

const KIND_LABEL: Record<AgentStep["kind"], string> = {
  plan: "plan",
  search: "search",
  assess: "assess",
};

function filterLabel(filters: AgentStep["filters"]): string | null {
  if (!filters) return null;
  const parts: string[] = [];
  if (filters.tickers?.length) parts.push(filters.tickers.join("/"));
  if (filters.fiscalYears?.length) parts.push(`FY${filters.fiscalYears.join("/FY")}`);
  if (filters.sections?.length) parts.push(filters.sections.join("/"));
  return parts.length > 0 ? parts.join(" · ") : null;
}

const STOPPED_LABEL: Record<AgentTrace["stoppedBecause"], string> = {
  sufficient: "stopped when evidence was sufficient",
  "iteration-cap": "stopped at the iteration cap",
  "no-progress": "stopped when searches stopped finding anything new",
  "no-retrieval-needed": "no retrieval needed",
};

export function AgentTraceView({ trace }: { trace: AgentTrace }) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
        <h2 className="text-[10px] uppercase tracking-[0.11em] text-muted-foreground">Retrieval path</h2>
        <span className="numeric text-[11px] text-muted-foreground">
          {trace.searches} searches · {trace.iterations} iteration{trace.iterations === 1 ? "" : "s"}
        </span>
      </div>

      <ol className="mt-3 space-y-1.5">
        {trace.steps.map((step, index) => {
          const filters = filterLabel(step.filters);
          return (
            <motion.li
              key={index}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.22, delay: Math.min(index * 0.04, 0.4), ease: "easeOut" }}
              className="flex items-baseline gap-3 text-[12px] leading-relaxed"
            >
              <span className="numeric w-[52px] shrink-0 text-[10px] uppercase tracking-[0.08em] text-marker">
                {KIND_LABEL[step.kind]}
              </span>
              <span className="min-w-0 flex-1 text-foreground">
                {step.query ? <span className="text-muted-foreground">“{step.query}”</span> : step.detail}
                {filters && <span className="ml-2 text-[11px] text-muted-foreground">{filters}</span>}
                {step.results !== undefined && step.kind === "search" && (
                  <span className="numeric ml-2 text-[11px] text-muted-foreground">
                    {step.results} found{step.newResults !== undefined ? `, ${step.newResults} new` : ""}
                  </span>
                )}
              </span>
              <span className="numeric shrink-0 text-[11px] text-muted-foreground">
                {(step.elapsedMs / 1000).toFixed(1)}s
              </span>
            </motion.li>
          );
        })}
      </ol>

      <p className="mt-3 text-[11px] text-muted-foreground">{STOPPED_LABEL[trace.stoppedBecause]}</p>
    </section>
  );
}
