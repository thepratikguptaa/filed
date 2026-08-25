"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CitationText } from "@/components/citation-text";
import { SourceCard } from "@/components/source-card";
import { AgentTraceView } from "@/components/agent-trace";
import type { AnswerResult } from "@/lib/answer";
import type { CorpusStats } from "@/lib/corpus";

const EXAMPLES = [
  "What was Apple's total net sales in fiscal 2025?",
  "How does Apple describe supply chain concentration risk?",
  "What cybersecurity risks does JPMorgan identify?",
  "How much did Pfizer spend on research and development?",
  "How did JPMorgan's net interest income change from FY2024 to FY2025?",
];

export function Console({ stats }: { stats: CorpusStats }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function ask(value: string) {
    const trimmed = value.trim();
    if (!trimmed || pending) return;

    setPending(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Request failed.");
      setResult(payload as AnswerResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  function scrollToSource(marker: string) {
    document.getElementById(`source-${marker}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHovered(marker);
    window.setTimeout(() => setHovered(null), 1200);
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 pb-24 sm:px-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5 pt-10">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-foreground">Filed</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Evidence from SEC filings, with every claim traced to a source passage.
          </p>
        </div>
        <dl className="flex items-end gap-6">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.11em] text-muted-foreground">Filings</dt>
            <dd className="numeric mt-0.5 text-[15px] text-foreground">{stats.documents}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.11em] text-muted-foreground">Passages</dt>
            <dd className="numeric mt-0.5 text-[15px] text-foreground">{stats.chunks.toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.11em] text-muted-foreground">Companies</dt>
            <dd className="mt-0.5 text-[15px] text-foreground">
              {stats.companies.map((company) => company.ticker).join(" · ")}
            </dd>
          </div>
        </dl>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
        className="mt-9 flex gap-2.5"
      >
        <Input
          ref={inputRef}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about a filing — a figure, a risk disclosure, a change between years"
          className="h-11 rounded-[3px] border-border bg-card text-[14px] shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button
          type="submit"
          disabled={pending || question.trim().length === 0}
          className="h-11 rounded-[3px] px-7 text-[13px] font-medium tracking-[0.01em]"
        >
          {pending ? "Searching" : "Ask"}
        </Button>
      </form>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => {
              setQuestion(example);
              void ask(example);
            }}
            className="text-left text-[12px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            {example}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {pending && (
          <motion.div
            key="pending"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-12 space-y-3"
          >
            <div className="h-3 w-1/3 animate-pulse rounded-[2px] bg-surface-sunken" />
            <div className="h-3 w-full animate-pulse rounded-[2px] bg-surface-sunken" />
            <div className="h-3 w-4/5 animate-pulse rounded-[2px] bg-surface-sunken" />
          </motion.div>
        )}

        {error && !pending && (
          <motion.p
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-12 border-l-2 border-destructive pl-4 text-[13px] text-destructive"
          >
            {error}
          </motion.p>
        )}

        {result && !pending && (
          <motion.div
            key={result.question}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_420px]"
          >
            <section>
              <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
                <h2 className="text-[10px] uppercase tracking-[0.11em] text-muted-foreground">Answer</h2>
                <span className="numeric text-[11px] text-muted-foreground">
                  {result.chunks.length} passages · {(result.elapsedMs / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="pt-5">
                <CitationText
                  text={result.answer}
                  onHoverMarker={setHovered}
                  onSelectMarker={scrollToSource}
                />
              </div>
              {result.trace && <AgentTraceView trace={result.trace} />}

              <p className="mt-8 border-t border-border pt-4 text-[11px] leading-relaxed text-muted-foreground">
                Filed reports what the filings say and cites where. It does not give investment advice.
              </p>
            </section>

            <aside>
              <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
                <h2 className="text-[10px] uppercase tracking-[0.11em] text-muted-foreground">Retrieved</h2>
                <span className="numeric text-[11px] text-muted-foreground">
                  {result.usedChunkIds.length} cited
                </span>
              </div>
              <ul className="mt-1 rounded-[3px] border border-border bg-card">
                {result.citations.map((citation, index) => (
                  <SourceCard
                    key={citation.chunkId}
                    citation={citation}
                    chunk={result.chunks[index]}
                    cited={result.usedChunkIds.includes(citation.chunkId)}
                    highlighted={hovered === citation.marker}
                    index={index}
                  />
                ))}
              </ul>
            </aside>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
