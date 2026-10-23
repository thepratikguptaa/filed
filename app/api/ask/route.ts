import { streamAnswer, type StreamEvent } from "@/lib/answer-stream";
import { checkRateLimit } from "@/lib/rate-limit";
import type { RetrievalStrategy } from "@/lib/retrieve";

export const maxDuration = 60;

interface AskBody {
  question?: string;
  strategy?: RetrievalStrategy;
  k?: number;
  history?: { question: string; answer: string };
}

function encodeEvent(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(request);
  if (!rateLimit.allowed) {
    return Response.json(
      { error: rateLimit.error ?? "Rate limit exceeded." },
      {
        status: rateLimit.status ?? 429,
        headers: {
          "Retry-After": String(Math.ceil(rateLimit.resetMs / 1000)),
        },
      },
    );
  }

  let body: AskBody;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const question = body.question?.trim();
  if (!question) {
    return Response.json({ error: "A question is required." }, { status: 400 });
  }
  if (question.length > 500) {
    return Response.json({ error: "Question is too long." }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const events = streamAnswer(question, {
          strategy: body.strategy ?? "agentic",
          k: Math.min(Math.max(body.k ?? 8, 1), 20),
          history: body.history,
        });

        for await (const event of events) {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        }
      } catch (error) {
        console.error("ask stream failed", error);
        const errorEvent: StreamEvent = {
          type: "error",
          message: "Retrieval or generation failed.",
        };
        controller.enqueue(encoder.encode(encodeEvent(errorEvent)));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
