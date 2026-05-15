// lib/bots/x-search.ts
//
// Thin wrapper around xAI's /v1/responses endpoint with the built-in
// `x_search` tool. This is xAI's replacement for the deprecated
// `search_parameters` shape on chat-completions.
//
// Why bypass @ai-sdk/xai: the SDK targets /v1/chat/completions, which
// can't use x_search. The Responses API does it natively — Grok decides
// when to call x_keyword_search, returns a final message with the
// quoted tweet + citation URL. Cheaper than maintaining our own
// keyword-search pipeline and matches Grok's native flow.
//
// Reads XAI_API_KEY from process.env, falling back to .env.local on
// disk for the same reason llm-trader.ts does (the dev server's env
// is frozen at boot).

import { readFileSync } from "node:fs";

const XAI_RESPONSES_URL = "https://api.x.ai/v1/responses";

function readKeyFromEnvLocal(name: string): string | undefined {
  try {
    const txt = readFileSync(".env.local", "utf-8");
    const m = txt.match(new RegExp("^" + name + "=(.+)$", "m"));
    const v = m?.[1].trim();
    if (!v) return undefined;
    return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
  } catch {
    return undefined;
  }
}

function getXaiKey(): string | undefined {
  if (process.env.XAI_API_KEY && process.env.XAI_API_KEY.length > 0) {
    return process.env.XAI_API_KEY;
  }
  return readKeyFromEnvLocal("XAI_API_KEY");
}

export interface XSearchCitation {
  url: string;
  title?: string;
}

export interface XSearchResult {
  text: string;
  citations: XSearchCitation[];
  toolCalls: number;
}

interface ResponsesOutputContent {
  type: string;
  text?: string;
  annotations?: Array<{ url?: string; title?: string }>;
}

interface ResponsesOutputItem {
  type: string;
  name?: string;
  content?: ResponsesOutputContent[];
}

interface ResponsesPayload {
  model: string;
  input: Array<{ role: "user" | "system"; content: string }>;
  tools: Array<{ type: string }>;
  max_output_tokens?: number;
}

interface ResponsesResponse {
  output?: ResponsesOutputItem[];
  error?: unknown;
}

export async function callXSearch(args: {
  model?: string;
  systemPrompt?: string;
  prompt: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}): Promise<XSearchResult | null> {
  const key = getXaiKey();
  if (!key) {
    console.warn("[x-search] XAI_API_KEY missing");
    return null;
  }

  const body: ResponsesPayload = {
    model: args.model ?? "grok-4.3",
    input: [],
    tools: [{ type: "x_search" }],
    max_output_tokens: args.maxOutputTokens ?? 800,
  };
  if (args.systemPrompt) {
    body.input.push({ role: "system", content: args.systemPrompt });
  }
  body.input.push({ role: "user", content: args.prompt });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), args.timeoutMs ?? 90_000);

  let resp: Response;
  try {
    resp = await fetch(XAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[x-search] fetch failed:`, err instanceof Error ? err.message : err);
    return null;
  }
  clearTimeout(timer);

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    console.warn(`[x-search] HTTP ${resp.status}: ${txt.slice(0, 200)}`);
    return null;
  }

  const data = (await resp.json().catch(() => null)) as ResponsesResponse | null;
  if (!data || !Array.isArray(data.output)) {
    console.warn(`[x-search] unexpected response shape`);
    return null;
  }

  let text = "";
  const citations: XSearchCitation[] = [];
  let toolCalls = 0;
  for (const item of data.output) {
    // xAI tool-call items can come back as type="tool_use" OR
    // type="custom_tool_call" depending on which version of the
    // Responses API is serving. Count any non-message/reasoning item
    // as a tool call for telemetry.
    if (item.type !== "message" && item.type !== "reasoning") {
      toolCalls += 1;
      continue;
    }
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const c of item.content) {
      if (c.type !== "output_text" || !c.text) continue;
      text += c.text;
      if (Array.isArray(c.annotations)) {
        for (const a of c.annotations) {
          if (a.url) citations.push({ url: a.url, title: a.title });
        }
      }
    }
  }

  if (!text) return null;
  return { text: text.trim(), citations, toolCalls };
}
