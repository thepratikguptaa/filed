const BOUNDARY = /(?<=[.!?])\s+(?=[A-Z"“(\[])/g;
const ABBREVIATION = /(?:^|\s)(?:[A-Z]|U\.S|Inc|Co|Corp|Ltd|No|St|Mr|Ms|Dr|vs|approx|est|Fig|pp)\.$/;
const MIN_SENTENCE = 15;

export interface Span {
  start: number;
  end: number;
  text: string;
}

export function sentenceSpans(text: string): Span[] {
  const cuts: number[] = [];
  for (const match of text.matchAll(BOUNDARY)) cuts.push(match.index + match[0].length);

  const spans: Span[] = [];
  let start = 0;
  for (const cut of [...cuts, text.length]) {
    const raw = text.slice(start, cut);
    const trimmed = raw.trimEnd();
    if (trimmed.length === 0) {
      start = cut;
      continue;
    }

    const previous = spans[spans.length - 1];
    if (previous && (ABBREVIATION.test(previous.text) || trimmed.length - (start - previous.end) < MIN_SENTENCE)) {
      previous.end = start + trimmed.length;
      previous.text = text.slice(previous.start, previous.end);
    } else {
      spans.push({ start, end: start + trimmed.length, text: trimmed });
    }
    start = cut;
  }
  return spans;
}

export function splitSentences(text: string): string[] {
  return sentenceSpans(text).map((span) => span.text);
}

export function markersIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\[C(\d+)\]/g)].map((match) => `C${match[1]}`))];
}
