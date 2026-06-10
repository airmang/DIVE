import type { ChatMessage } from "./types";

/**
 * Prefix of the interview-submit / revision prompts (see i18n
 * `planning.interview.submit_prompt` and `revision_prompt`). Both locales start
 * the prompt with this literal marker.
 */
export const INTERVIEW_SUBMIT_MARKER = "[INTERVIEW_SUBMIT]";

function stripJsonFence(content: string): string {
  const trimmed = content.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : trimmed;
}

/**
 * Structural detection of the plan-draft JSON reply. The model emits it both
 * after the `[INTERVIEW_SUBMIT]` button prompt AND after a conversational
 * accept ("네, 이대로 계획을 만들어 주세요"), so the transcript filter cannot
 * key off the marker alone — it must recognize the payload itself, the same
 * shape `usePlanInterviewLLM` parses into the plan card.
 *
 * While the reply is still streaming the JSON is incomplete and unparseable,
 * so a prefix heuristic hides the bubble during the stream too.
 */
export function looksLikePlanDraftJson(content: string, streaming: boolean): boolean {
  const source = stripJsonFence(content);
  if (!source.startsWith("{")) return false;
  if (streaming) {
    return source.includes('"plan_input"') || source.includes('"intent_summary"');
  }
  const candidate = (() => {
    try {
      return JSON.parse(source) as unknown;
    } catch {
      const first = source.indexOf("{");
      const last = source.lastIndexOf("}");
      if (first === -1 || last <= first) return null;
      try {
        return JSON.parse(source.slice(first, last + 1)) as unknown;
      } catch {
        return null;
      }
    }
  })();
  if (typeof candidate !== "object" || candidate === null) return false;
  const payload = candidate as Record<string, unknown>;
  const planInput = payload.plan_input ?? payload.planInput;
  if (typeof planInput !== "object" || planInput === null) return false;
  return Array.isArray((planInput as Record<string, unknown>).steps);
}

/**
 * Hide the interview-submit machinery from the chat transcript.
 *
 * When a student finishes the Socratic interview — via the 인터뷰 완료 button
 * (which sends an `[INTERVIEW_SUBMIT] …` prompt) or by accepting the AI's
 * proposal conversationally — the model replies with raw plan-draft JSON that
 * `usePlanInterviewLLM` parses into the plan card. Neither the machinery
 * prompt nor the JSON is meant for the student to read — the plan-draft card
 * and roadmap communicate the result — so both are dropped from the rendered
 * transcript. Order-preserving, so it works on both live events and reloaded
 * history. The Socratic Q&A turns are untouched.
 */
export function filterInterviewNoise(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let suppressing = false;
  for (const message of messages) {
    if (
      message.kind === "user" &&
      message.content.trimStart().startsWith(INTERVIEW_SUBMIT_MARKER)
    ) {
      // Drop the machinery prompt and begin suppressing its JSON reply.
      suppressing = true;
      continue;
    }
    if (
      message.kind === "assistant" &&
      looksLikePlanDraftJson(message.content, message.streaming)
    ) {
      // Plan-draft JSON reply — hidden on both the button path and the
      // conversational-accept path, live or from reloaded history.
      suppressing = false;
      continue;
    }
    if (suppressing) {
      if (message.kind === "assistant") {
        // Reply to the submit prompt that didn't parse as a plan draft (e.g.
        // an error string) — still machinery, drop it and stop suppressing.
        suppressing = false;
        continue;
      }
      if (message.kind === "reasoning") {
        // Reasoning tied to the submit turn — drop alongside the reply.
        continue;
      }
      // Anything else (error, next user turn, system) ends suppression and renders.
      suppressing = false;
    }
    out.push(message);
  }
  return out;
}
