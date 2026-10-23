"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CitationText } from "@/components/citation-text";
import { SourceCard } from "@/components/source-card";
import { AgentTraceView } from "@/components/agent-trace";
import type { AnswerCitation } from "@/lib/answer";
import type { AgentStep, AgentTrace } from "@/lib/agent/types";
import { type CorpusStats, getCompanyFullName } from "@/lib/companies";
import type { Chunk } from "@/lib/types";
import type { StreamEvent } from "@/lib/answer-stream";

const EXAMPLES = [
  "What was Apple's total net sales in fiscal 2025?",
  "How does Apple describe supply chain concentration risk?",
  "What cybersecurity risks does JPMorgan identify?",
  "How much did Pfizer spend on research and development?",
  "How did JPMorgan's net interest income change from FY2024 to FY2025?",
];

interface StreamResult {
  question: string;
  trace: AgentTrace | null;
  citations: AnswerCitation[];
  chunks: Chunk[];
  draftAnswer: string;
  finalAnswer: string | null;
  usedChunkIds: string[];
  model: string;
  elapsedMs: number;
}

function emptyResult(question: string): StreamResult {
  return {
    question,
    trace: null,
    citations: [],
    chunks: [],
    draftAnswer: "",
    finalAnswer: null,
    usedChunkIds: [],
    model: "",
    elapsedMs: 0,
  };
}

export function Console({ stats }: { stats: CorpusStats }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<StreamResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<"idle" | "retrieving" | "answering" | "attributing" | "done">("idle");
  const [hovered, setHovered] = useState<string | null>(null);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Conversation history: last completed Q&A pair
  const lastTurnRef = useRef<{ question: string; answer: string } | null>(null);

  const ask = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || pending) return;

    setPending(true);
    setError(null);
    setResult(emptyResult(trimmed));
    setPhase("retrieving");
    setLiveSteps([]);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          history: lastTurnRef.current,
        }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error((payload as { error?: string }).error ?? "Request failed.");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No stream available.");

      const decoder = new TextDecoder();
      let buffer = "";
      let currentDraft = "";
      const collectedSteps: AgentStep[] = [];

      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;

        buffer += decoder.decode(chunk, { stream: true });

        // Parse SSE events from the buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        let eventType = "";
        let eventData = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            eventData = line.slice(6);

            if (!eventType || !eventData) continue;

            try {
              const event = JSON.parse(eventData) as StreamEvent;

              switch (event.type) {
                case "trace": {
                  collectedSteps.push(event.step);
                  setLiveSteps([...collectedSteps]);
                  break;
                }
                case "sources": {
                  setPhase("answering");
                  setResult((prev) =>
                    prev
                      ? { ...prev, citations: event.citations, chunks: event.chunks }
                      : null,
                  );
                  break;
                }
                case "answer-delta": {
                  currentDraft += event.text;
                  const draft = currentDraft;
                  setResult((prev) =>
                    prev ? { ...prev, draftAnswer: draft } : null,
                  );
                  break;
                }
                case "answer-done": {
                  setPhase("done");
                  setResult((prev) =>
                    prev
                      ? {
                          ...prev,
                          finalAnswer: event.answer,
                          usedChunkIds: event.usedChunkIds,
                          model: event.model,
                          elapsedMs: event.elapsedMs,
                          trace: event.trace ?? prev.trace,
                        }
                      : null,
                  );
                  // Save for follow-up context
                  lastTurnRef.current = { question: trimmed, answer: event.answer };
                  break;
                }
                case "error": {
                  throw new Error(event.message);
                }
              }
            } catch (e) {
              if (e instanceof Error && e.message !== eventData) throw e;
              // Skip malformed JSON lines
            }

            eventType = "";
            eventData = "";
          }
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
      setPhase("idle");
    } finally {
      setPending(false);
    }
  }, [pending]);

  function scrollToSource(marker: string) {
    document.getElementById(`source-${marker}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHovered(marker);
    window.setTimeout(() => setHovered(null), 1200);
  }

  const displayAnswer = result?.finalAnswer ?? result?.draftAnswer ?? "";
  const showResult = result && (displayAnswer || result.citations.length > 0);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-6 pb-24 sm:px-10">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5 pt-10">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-foreground">Filed</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Evidence from SEC filings, with every claim traced to a source passage.
          </p>
        </div>
        <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-3">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.11em] text-muted-foreground">Filings</dt>
            <dd className="numeric mt-0.5 text-[15px] text-foreground">{stats.documents}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.11em] text-muted-foreground">Passages</dt>
            <dd className="numeric mt-0.5 text-[15px] text-foreground">{stats.chunks.toLocaleString()}</dd>
          </div>
          <div className="max-w-xl">
            <dt className="text-[10px] uppercase tracking-[0.11em] text-muted-foreground">Companies</dt>
            <dd className="mt-0.5 text-[14px] leading-snug text-foreground">
              {stats.companies.map((company) => company.company || getCompanyFullName(company.ticker)).join(" · ")}
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

      {/* Live retrieval trace — shown during agent retrieval */}
      <AnimatePresence>
        {pending && liveSteps.length > 0 && phase === "retrieving" && (
          <motion.div
            key="live-trace"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <AgentTraceView trace={{ steps: liveSteps }} live />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Streaming skeleton when waiting for sources */}
      <AnimatePresence mode="wait">
        {pending && liveSteps.length === 0 && !showResult && (
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

        {showResult && (
          <motion.div
            key={result.question}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_420px]"
          >
            <section>
              <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
                <h2 className="text-[10px] uppercase tracking-[0.11em] text-muted-foreground">
                  Answer
                  {phase !== "done" && (
                    <span className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-marker" />
                  )}
                </h2>
                <span className="numeric text-[11px] text-muted-foreground">
                  {result.chunks.length > 0 && `${result.chunks.length} passages`}
                  {result.elapsedMs > 0 && ` · ${(result.elapsedMs / 1000).toFixed(1)}s`}
                  {phase === "attributing" && " · verifying citations…"}
                </span>
              </div>
              <div className="pt-5">
                <CitationText
                  text={displayAnswer}
                  onHoverMarker={setHovered}
                  onSelectMarker={scrollToSource}
                />
              </div>

              {/* Show trace after completion, or live trace after retrieval phase */}
              {result.trace && phase === "done" && <AgentTraceView trace={result.trace} />}
              {!result.trace && liveSteps.length > 0 && phase !== "retrieving" && (
                <AgentTraceView
                  trace={{
                    question: result.question,
                    steps: liveSteps,
                    searches: liveSteps.filter((s) => s.kind === "search").length,
                    iterations: liveSteps.length > 0 ? liveSteps[liveSteps.length - 1].iteration : 0,
                    stoppedBecause: "sufficient",
                  }}
                />
              )}

              <p className="mt-8 border-t border-border pt-4 text-[11px] leading-relaxed text-muted-foreground">
                Filed reports what the filings say and cites where. It does not give investment advice.
              </p>
            </section>

            <aside>
              <div className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
                <h2 className="text-[10px] uppercase tracking-[0.11em] text-muted-foreground">Retrieved</h2>
                <span className="numeric text-[11px] text-muted-foreground">
                  {result.usedChunkIds.length > 0 && `${result.usedChunkIds.length} cited`}
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
