// Thin wrapper around the Commonstack chat-completions API (OpenAI-compat)
// powering DeepSeek v4-flash. Brief uses LLM only as a *reasoning enricher*
// on top of real DeFiLlama data · the allocations + warnings come from
// real numbers regardless. So if LLM is unavailable, agents fall back to
// a deterministic template paragraph generated from the same data.
//
// CREDIT SAFETY:
//   - LLM is called ONLY inside an agent's onEvent handler, which only
//     fires when a real new on-chain mint event arrives.
//   - No idle calls. No polling of the LLM provider. Agents at rest cost
//     nothing.
//   - In-memory call counter exposed via llmCallsThisSession() for any
//     future dashboard.
//
// Switch via env: BRIEF_LLM_MODE=mock|llm  (default: llm if key set, mock otherwise).

export type LlmRequest = {
  apiKey: string;
  model?: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
  /** Optional sampling temperature (0 = deterministic · best for structured JSON). */
  temperature?: number;
  /** Optional top-k sampling (tightens output · pairs with temperature 0). */
  topK?: number;
  /** Optional override of provider endpoint */
  endpoint?: string;
  /** Optional JSON schema hint appended to user prompt */
  jsonSchemaHint?: string;
};

export type LlmEnv = {
  anthropicApiKey?: string;
  commonstackApiKey?: string;
};

const COMMONSTACK_ENDPOINT = "https://api.commonstack.ai/v1/chat/completions";
/**
 * The primary AI model · a fast, NON-reasoning model that returns clean JSON.
 * Reasoning models (e.g. deepseek-v4-flash) emit chain-of-thought scratchpad in
 * `content`, which breaks structured-output parsing and blows latency. Grok 4.1
 * Fast (non-reasoning) answers the full advisor prompt in ~5s with clean JSON.
 * Used as the default across the advisor, macro oracle, daily reflection, and
 * narration. Override per-surface via the BRIEF_*_MODEL / COMMONSTACK_MODEL envs.
 */
export const DEFAULT_AI_MODEL = "x-ai/grok-4-1-fast-non-reasoning";
const DEFAULT_MODEL = DEFAULT_AI_MODEL;

let _callCount = 0;
let _promptTokens = 0;
let _completionTokens = 0;

export function llmCallsThisSession() {
  return {
    calls: _callCount,
    promptTokens: _promptTokens,
    completionTokens: _completionTokens,
  };
}

export function llmMode(env: LlmEnv): "mock" | "llm" {
  const explicit = process.env.BRIEF_LLM_MODE;
  if (explicit === "mock") return "mock";
  if (explicit === "llm" || explicit === "anthropic" || explicit === "commonstack") {
    return "llm";
  }
  const haveKey = !!(env.commonstackApiKey || env.anthropicApiKey);
  return haveKey ? "llm" : "mock";
}

/**
 * Call the LLM. Returns the assistant's response text (plain prose unless
 * jsonSchemaHint was set, in which case JSON-shaped). Records the call in
 * the in-memory counter so we can audit credits later.
 *
 * Strategy: Commonstack DeepSeek v4-flash by default · fast reasoning model
 * with prompt + completion separated. We extract `message.content` (the
 * final answer) and fall back to `reasoning_content` (the thinking trace)
 * if content is empty (which can happen on truncation).
 */
export async function callLlm(req: LlmRequest): Promise<string> {
  const endpoint = req.endpoint ?? COMMONSTACK_ENDPOINT;
  const model = req.model ?? DEFAULT_MODEL;

  const messages: { role: string; content: string }[] = [];
  if (req.system) {
    messages.push({ role: "system", content: req.system });
  }
  messages.push({
    role: "user",
    content: req.jsonSchemaHint
      ? `${req.prompt}\n\nRespond with valid JSON only, matching this schema:\n${req.jsonSchemaHint}`
      : req.prompt,
  });

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: req.maxTokens ?? 512,
      ...(req.temperature != null ? { temperature: req.temperature } : {}),
      ...(req.topK != null ? { top_k: req.topK } : {}),
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`LLM ${resp.status}: ${text.slice(0, 200)}`);
  }

  type CompletionResponse = {
    choices?: Array<{
      message?: {
        content?: string;
        reasoning_content?: string;
      };
      finish_reason?: string;
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
    };
  };

  const json = (await resp.json()) as CompletionResponse;
  const choice = json.choices?.[0];
  if (!choice?.message) {
    throw new Error("LLM response missing choices[0].message");
  }

  const content = (choice.message.content ?? "").trim();
  const reasoning = (choice.message.reasoning_content ?? "").trim();

  // Bookkeeping
  _callCount++;
  _promptTokens += json.usage?.prompt_tokens ?? 0;
  _completionTokens += json.usage?.completion_tokens ?? 0;

  // DeepSeek v4-flash puts the final answer in `content` after thinking
  // in `reasoning_content`. On truncation only reasoning may be filled;
  // we'd rather return the (partial) thinking than empty string.
  if (content) return content;
  if (reasoning) return reasoning;
  throw new Error("LLM returned empty content + reasoning");
}

export function extractJson<T>(raw: string): T {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  return JSON.parse(trimmed) as T;
}
