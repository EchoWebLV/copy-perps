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
  // ── Liquidation Lizard family ────────────────────────────────────────
  {
    key: "liquidation-lizard",
    prompt:
      "Predatory hunter robot. Reptilian-plated angular skull, mouth ajar revealing sharp white robotic fangs, glowing acid-yellow slit eyes, dark gunmetal-green chrome plating, exposed servo-tendons in jaw, single curved horn over each temple. Aggressive, smug, lurking energy." +
      STYLE,
  },
  {
    key: "liquidation-lizard-jr",
    prompt:
      "Junior version of a predatory hunter robot: same dark gunmetal-green chrome family but cuter, smaller, scrappier, slightly cartoony proportions, oversized acid-yellow round eyes, one stubby antenna, tiny robotic fangs in a curious open mouth, pet-like vibe." +
      STYLE,
  },
  // ── Funding Phoebe family ────────────────────────────────────────────
  {
    key: "funding-phoebe",
    prompt:
      "Quant analyst robot. Sleek clean white-and-chrome head, single large glowing cyan cyclopean eye-lens, thin telescoping antenna with a tiny dish, soft inner blue glow, smooth featureless face plate. Cold, precise, analytical." +
      STYLE,
  },
  {
    key: "funding-phoebe-lite",
    prompt:
      "Stripped-down lite version of a white-and-chrome quant analyst robot: matte off-white finish, missing chest and cheek panels exposing copper wiring, simpler smaller cyan eye-lens, no antenna, slightly tilted head, casual budget-build vibe." +
      STYLE,
  },
  // ── Mean-Revert Mike family ──────────────────────────────────────────
  {
    key: "mean-revert-mike",
    prompt:
      "Weathered contrarian robot. Bronze-and-copper paint job with light tarnish and scratches, oversized monocle-style ring around one mechanical eye, single robotic eyebrow arc raised skeptically, slight smirk built into the mouth plate. Cynical, patient, old-timer." +
      STYLE,
  },
  {
    key: "mean-revert-mike-patient",
    prompt:
      "Zen older sibling of a bronze contrarian robot: same bronze-and-copper family but smoother polished surfaces, no monocle, soft glowing amber meditation orb between the brows, beard-like cable strands hanging from the jaw, calm closed mechanical eyelids. Monk-like, deeply patient." +
      STYLE,
  },
  // ── Momo Max family ─────────────────────────────────────────────────
  {
    key: "momo-max",
    prompt:
      "Hype energy robot. Glossy orange-and-red metal, mouth open mid-shout revealing speaker-grille throat, two upright antennas with tiny sirens on top, glowing red lens eyes, kinetic motion shimmer around the head. Adrenaline, hype, riding the wave." +
      STYLE,
  },
  {
    key: "momo-max-aggressive",
    prompt:
      "Extreme variant of a red-orange hype robot: same color family but with aggressive black spikes around the skull, red-hot glowing seams, exhaust vents on the cheeks emitting thin smoke, one larger predatory mono-lens eye glowing crimson, snarling open mouth. Pure degen energy." +
      STYLE,
  },
  // ── Vol Vector family ───────────────────────────────────────────────
  {
    key: "vol-vector",
    prompt:
      "Mathematical geometric robot. Crystalline polyhedron skull made of intersecting flat planes, glowing neon purple and cyan vector lines along every edge, no traditional eyes — a triangular glowing slit where the face would be, calm calculating presence." +
      STYLE,
  },
  {
    key: "vol-vector-hair-trigger",
    prompt:
      "Jittery sharper variant of a crystalline polyhedron robot: same purple-cyan vector family but fractured into more shards, head split along a glowing seam, brighter pulsing neon, sharper points, glitch-art aesthetic, ready to fire." +
      STYLE,
  },
  // ── Boomer Trend family ─────────────────────────────────────────────
  {
    key: "boomer-trend",
    prompt:
      "Vintage analog robot. Polished brass and dark mahogany head, art-deco face plate symmetry, two small round glass dial eyes showing tiny needles, a built-in pocket-watch face on the forehead, slow wise expression. Old-school Wall Street." +
      STYLE,
  },
  {
    key: "boomer-trend-wide",
    prompt:
      "Stockier wider version of a vintage brass-and-mahogany robot: same art-deco family but broader rounded skull, fuller cheek plates, a single oversized glass-dial eye in the middle of the forehead, calm dignified. Heavy and committed." +
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
