import { answerQuestion } from "@/lib/answer";
import type { RetrievalStrategy } from "@/lib/retrieve";

export const maxDuration = 60;

export async function POST(request: Request) {
  let body: { question?: string; strategy?: RetrievalStrategy; k?: number };

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

  try {
    const result = await answerQuestion(question, {
      strategy: body.strategy ?? "hybrid",
      k: Math.min(Math.max(body.k ?? 8, 1), 20),
    });
    return Response.json(result);
  } catch (error) {
    console.error("ask failed", error);
    return Response.json({ error: "Retrieval or generation failed." }, { status: 500 });
  }
}
