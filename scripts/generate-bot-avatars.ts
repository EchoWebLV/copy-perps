// scripts/generate-bot-avatars.ts
//
// Generates one robot portrait per bot id (12 total) using the latest
// available OpenAI image model. Parent/variant pairs share visual DNA
// but each robot is distinct. All on pure black backgrounds, head only.
// Saves to public/bots/{bot-id}.png.
//
// OPENAI_API_KEY env var is required and is never persisted to disk.

import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
  console.error("OPENAI_API_KEY env var required");
  process.exit(1);
}

const MODEL_FALLBACK_CHAIN = [
  "gpt-image-2-2026-04-21",
  "gpt-image-2-latest",
  "gpt-image-1",
] as const;

const STYLE =
  " 3D rendered robot bust, profile-picture composition, head only, perfectly centered, pure solid #000000 black background, dramatic studio rim lighting, vivid color accents, ultra-detailed metallic shading, cinematic, sharp focus, no text, no logos, no watermarks, no scenery.";

interface PersonaSpec {
  key: string;
  prompt: string;
}

const BOTS: PersonaSpec[] = [
  // ── Vulture (liquidation-cascade fader) ─────────────────────────────
  {
    key: "vulture",
    prompt:
      "Scavenger raptor robot. Bald gunmetal-grey angular skull with hunched neck plating, glowing blood-red lens eyes deep in sockets, hooked metallic beak slightly open with serrated edges, fan of carbon-fibre feathers around the collar, calm patient predatory expression. Picking-the-bones energy." +
      STYLE,
  },
  // ── Funding Sniper (funding-extreme fader) ──────────────────────────
  {
    key: "funding-sniper",
    prompt:
      "Marksman robot. Sleek matte forest-green tactical head, single oversized cyclopean scope-lens eye glowing thin laser-red, hexagonal mesh cheek plates, communications antenna folded along the side, deeply still calm expression, faint crosshair reticle glow inside the lens. Quiet, patient, lethal." +
      STYLE,
  },
  // ── Contrarian (fades roster consensus) ─────────────────────────────
  {
    key: "contrarian",
    prompt:
      "Outsider robot. Asymmetrical split head, left half polished black chrome with a glowing white lens eye, right half polished white chrome with a glowing black lens eye, a dryly amused half-smirk built into the mouth plate. Confident standoffish vibe, takes-the-other-side energy." +
      STYLE,
  },
  // ── Whale Shadow (copies tracked whales) ────────────────────────────
  {
    key: "whale-shadow",
    prompt:
      "Stealth follower robot. Deep-ocean navy chrome head with a smooth whale-like dome forehead, large glowing teal cyclopean eye-lens with bioluminescent ripple patterns, no mouth — a subtle speaker grille slit, two streamlined antenna-fins along the temples like a whale's flukes. Quiet humble shadow-the-whale energy." +
      STYLE,
  },
  // ── Grok (xAI LLM trader) ───────────────────────────────────────────
  {
    key: "grok-trader",
    prompt:
      "AI-reasoning robot. Polished black-and-silver brushed-metal head with subtle iridescent oil-slick rainbow reflections, two glowing electric-violet lens eyes asymmetric in size, slim antenna with a single glowing pixel-cube on top, slightly cocky smirk built into the mouth plate, the letter X subtly embossed on one temple. Intellectually arrogant chaotic-good vibe." +
      STYLE,
  },
  // ── Claude (Anthropic LLM trader) ───────────────────────────────────
  {
    key: "claude-trader",
    prompt:
      "AI-reasoning robot. Smooth warm cream-white ceramic head with soft golden trim along every seam, two large gentle amber lens eyes set wide and slightly low, no visible mouth — a calm closed face plate where one would be, a single warm-gold halo ring floating just above the head. Thoughtful careful brand-new energy, measured posture." +
      STYLE,
  },
];

interface OpenAiImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string };
}

async function generateOnce(
  p: PersonaSpec,
  model: string,
): Promise<{ ok: true; buf: Buffer } | { ok: false; status: number; msg: string }> {
  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: p.prompt,
      n: 1,
      size: "1024x1024",
      quality: "medium",
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    return { ok: false, status: resp.status, msg: txt.slice(0, 500) };
  }
  const data = (await resp.json()) as OpenAiImageResponse;
  const b64 = data.data?.[0]?.b64_json;
  if (b64) {
    return { ok: true, buf: Buffer.from(b64, "base64") };
  }
  const url = data.data?.[0]?.url;
  if (url) {
    const imgResp = await fetch(url);
    if (!imgResp.ok) {
      return { ok: false, status: imgResp.status, msg: "url fetch failed" };
    }
    const buf = Buffer.from(await imgResp.arrayBuffer());
    return { ok: true, buf };
  }
  return { ok: false, status: 500, msg: "no image data in response" };
}

async function generate(
  p: PersonaSpec,
  workingModel: string | null,
): Promise<string | null> {
  const models = workingModel ? [workingModel] : MODEL_FALLBACK_CHAIN;
  for (const m of models) {
    const r = await generateOnce(p, m);
    if (r.ok) {
      const outDir = join(process.cwd(), "public", "bots");
      await mkdir(outDir, { recursive: true });
      const outPath = join(outDir, `${p.key}.png`);
      await writeFile(outPath, r.buf);
      console.log(
        `[${p.key.padEnd(28)}] ✓ ${m} (${(r.buf.length / 1024).toFixed(0)} kB)`,
      );
      return m;
    }
    const modelMissing =
      r.status === 404 ||
      /model.*(not found|does not exist|invalid)/i.test(r.msg);
    if (modelMissing) {
      console.warn(
        `[${p.key}] model "${m}" rejected (HTTP ${r.status}), trying next…`,
      );
      continue;
    }
    console.error(`[${p.key}] ✗ ${m} HTTP ${r.status}: ${r.msg}`);
    return null;
  }
  console.error(`[${p.key}] ✗ no model in the fallback chain worked`);
  return null;
}

async function main() {
  let workingModel: string | null = null;
  for (const p of BOTS) {
    const got = await generate(p, workingModel);
    if (got) workingModel = got;
  }
  console.log(workingModel ? `\nDone (model: ${workingModel}).` : "\nAll failed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
