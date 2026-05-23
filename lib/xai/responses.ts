import { readFileSync } from "node:fs";
import type { z } from "zod";

export const XAI_RESPONSES_URL = "https://api.x.ai/v1/responses";
export const XAI_RESPONSES_MODEL_ID = "grok-4.3";
export const XAI_NON_REASONING = { effort: "none" } as const;

type XaiInputRole = "system" | "user" | "assistant";

export interface XaiInputMessage {
  role: XaiInputRole;
  content: string;
}

interface ResponsesOutputContent {
  type: string;
  text?: string;
  annotations?: Array<{ url?: string; title?: string }>;
}

interface ResponsesOutputItem {
  type: string;
  content?: ResponsesOutputContent[];
}

interface ResponsesResponse {
  output_text?: string;
  output?: ResponsesOutputItem[];
  error?: unknown;
}

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

export function getXaiApiKey(): string | undefined {
  if (process.env.XAI_API_KEY && process.env.XAI_API_KEY.length > 0) {
    return process.env.XAI_API_KEY;
  }
  return readKeyFromEnvLocal("XAI_API_KEY");
}

export function extractXaiOutputText(data: ResponsesResponse): string {
  if (typeof data.output_text === "string") return data.output_text.trim();

  let text = "";
  for (const item of data.output ?? []) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content.type === "output_text" && content.text) {
        text += content.text;
      }
    }
  }
  return text.trim();
}

function stripJsonFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
}

export async function callXaiResponses(args: {
  input: XaiInputMessage[];
  maxOutputTokens?: number;
  model?: string;
  timeoutMs?: number;
  tools?: Array<Record<string, unknown>>;
}): Promise<ResponsesResponse> {
  const key = getXaiApiKey();
  if (!key) throw new Error("XAI_API_KEY missing");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), args.timeoutMs ?? 90_000);

  try {
    const resp = await fetch(XAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: args.model ?? XAI_RESPONSES_MODEL_ID,
        reasoning: XAI_NON_REASONING,
        input: args.input,
        tools: args.tools,
        max_output_tokens: args.maxOutputTokens,
      }),
      signal: ac.signal,
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`xAI Responses HTTP ${resp.status}: ${txt.slice(0, 200)}`);
    }

    const data = (await resp.json().catch(() => null)) as ResponsesResponse | null;
    if (!data || typeof data !== "object") {
      throw new Error("xAI Responses returned invalid JSON");
    }
    if (data.error) {
      throw new Error(`xAI Responses error: ${JSON.stringify(data.error)}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateXaiText(args: {
  systemPrompt?: string;
  prompt: string;
  maxOutputTokens?: number;
  model?: string;
  timeoutMs?: number;
}): Promise<string> {
  const input: XaiInputMessage[] = [];
  if (args.systemPrompt) {
    input.push({ role: "system", content: args.systemPrompt });
  }
  input.push({ role: "user", content: args.prompt });

  const data = await callXaiResponses({
    input,
    maxOutputTokens: args.maxOutputTokens,
    model: args.model,
    timeoutMs: args.timeoutMs,
  });
  const text = extractXaiOutputText(data);
  if (!text) throw new Error("xAI Responses returned no text");
  return text;
}

export async function generateXaiTextFromMessages(args: {
  systemPrompt?: string;
  messages: XaiInputMessage[];
  maxOutputTokens?: number;
  model?: string;
  timeoutMs?: number;
}): Promise<string> {
  const input: XaiInputMessage[] = [];
  if (args.systemPrompt) {
    input.push({ role: "system", content: args.systemPrompt });
  }
  input.push(...args.messages);

  const data = await callXaiResponses({
    input,
    maxOutputTokens: args.maxOutputTokens,
    model: args.model,
    timeoutMs: args.timeoutMs,
  });
  const text = extractXaiOutputText(data);
  if (!text) throw new Error("xAI Responses returned no text");
  return text;
}

export async function generateXaiJson<T>(args: {
  schema: z.ZodType<T>;
  systemPrompt?: string;
  prompt: string;
  maxOutputTokens?: number;
  model?: string;
  timeoutMs?: number;
}): Promise<T> {
  const text = await generateXaiText({
    systemPrompt: args.systemPrompt,
    prompt: `${args.prompt}\n\nReturn only one valid JSON object. No markdown.`,
    maxOutputTokens: args.maxOutputTokens,
    model: args.model,
    timeoutMs: args.timeoutMs,
  });
  return args.schema.parse(JSON.parse(stripJsonFence(text)));
}
