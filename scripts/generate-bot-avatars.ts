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
  // ── v4 active roster ────────────────────────────────────────────────
  //
  // Each avatar is concept-driven: the robot is shaped LIKE the thing
  // it represents (a whale, a satellite, a sniper, a wave-rider),
  // not a generic humanoid robot in different colors.

  // Whale — mirrors a real Hyperliquid whale. Robot whale.
  {
    key: "whale",
    prompt:
      "Robotic mechanical whale head, viewed three-quarters facing camera. Massive smooth cobalt-blue and brushed-titanium chrome plating shaped exactly like a humpback whale's head — rounded dome forehead, long curved lower jaw, two pectoral fin elements visible at the base of the neck, a chrome blowhole on top with faint steam exhaust. A single huge glowing aqua-cyan cyclopean eye-lens with concentric ripple-rings on the side of the head. Calm, gentle, mighty presence. Filling the frame head-only." +
      STYLE,
  },

  // Native — mirrors a top Pacifica wallet. Solana cyber-ronin.
  {
    key: "native",
    prompt:
      "Solana-native cyber-ronin robot head, three-quarter view. Sleek obsidian and chrome face plate with vivid Solana-gradient (electric-purple flowing into hot-magenta flowing into neon-mint) energy streaks pulsing along every seam, sharp samurai-style cheek guards, a single horizontal slit-eye glowing magenta, a low chrome topknot antenna swept back, two small gradient flag-fins along the temples. Calm warrior-pride home-team energy. Filling the frame head-only." +
      STYLE,
  },

  // Sniper — fades cross-CEX funding extremes. Tactical sniper robot.
  {
    key: "funding-sniper",
    prompt:
      "Tactical sniper robot head, three-quarter view. Matte forest-green and gunmetal plating with hexagonal mesh cheek guards, a massive oversized cyclopean rifle-scope eye-lens dominating the face — glass front with thin laser-red crosshair reticle inside, scope mounting rails on top, twin range-finding antenna-spikes folded back along the crown, a small comms patch on one temple, faint ghillie-strand carbon fibers along the neck collar. Quiet, patient, lethal stillness. Filling the frame head-only." +
      STYLE,
  },

  // Pulse — Grok 4.3 + X live search. Communications satellite robot.
  {
    key: "pulse",
    prompt:
      "Communications-satellite robot head, three-quarter view. Polished midnight-blue chrome dome-skull shaped like a comms satellite — a single large dish-antenna face replacing a normal face, with a glowing electric-cyan emitter dot at the center, twin gold-foil solar-panel wings flaring out from the temples like ears, three smaller whip-antennas of varying lengths rising from the crown each tipped with a tiny blinking white pulse light, faint waveform engraving on the throat collar. Always-listening always-broadcasting energy. Filling the frame head-only." +
      STYLE,
  },

  // ── Dormant bot families below are kept for revival; the active
  //    roster above is what the v4 build uses.

  // Vulture (dormant — liquidation-cascade fader)
  {
    key: "vulture",
    prompt:
      "Scavenger raptor robot. Bald gunmetal-grey angular skull with hunched neck plating, glowing blood-red lens eyes deep in sockets, hooked metallic beak slightly open with serrated edges, fan of carbon-fibre feathers around the collar, calm patient predatory expression. Picking-the-bones energy." +
      STYLE,
  },
  // Contrarian (dormant — fades roster consensus)
  {
    key: "contrarian",
    prompt:
      "Outsider robot. Asymmetrical split head, left half polished black chrome with a glowing white lens eye, right half polished white chrome with a glowing black lens eye, a dryly amused half-smirk built into the mouth plate. Confident standoffish vibe, takes-the-other-side energy." +
      STYLE,
  },
  // Whale Shadow (dormant — older whale tracker)
  {
    key: "whale-shadow",
    prompt:
      "Stealth follower robot. Deep-ocean navy chrome head with a smooth whale-like dome forehead, large glowing teal cyclopean eye-lens with bioluminescent ripple patterns, no mouth — a subtle speaker grille slit, two streamlined antenna-fins along the temples like a whale's flukes. Quiet humble shadow-the-whale energy." +
      STYLE,
  },
  // Grok-trader (dormant — autonomous xAI LLM trader, replaced by Pulse)
  {
    key: "grok-trader",
    prompt:
      "AI-reasoning robot. Polished black-and-silver brushed-metal head with subtle iridescent oil-slick rainbow reflections, two glowing electric-violet lens eyes asymmetric in size, slim antenna with a single glowing pixel-cube on top, slightly cocky smirk built into the mouth plate, the letter X subtly embossed on one temple. Intellectually arrogant chaotic-good vibe." +
      STYLE,
  },
  // Claude-trader (dormant — autonomous Anthropic LLM trader)
  {
    key: "claude-trader",
    prompt:
      "AI-reasoning robot. Smooth warm cream-white ceramic head with soft golden trim along every seam, two large gentle amber lens eyes set wide and slightly low, no visible mouth — a calm closed face plate where one would be, a single warm-gold halo ring floating just above the head. Thoughtful careful brand-new energy, measured posture." +
      STYLE,
  },
];

// Restrict CLI runs to a subset by passing keys: `tsx ... -- whale pulse`
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ACTIVE_KEYS = new Set(["whale", "native", "funding-sniper", "pulse"]);

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
  // Default: only regenerate the 4 active v4 bots. Pass explicit keys
  // on the CLI to regenerate any specific subset (including dormant
  // ones) — e.g. `tsx scripts/generate-bot-avatars.ts vulture grok-trader`.
  const target = FILTER.length > 0 ? new Set(FILTER) : ACTIVE_KEYS;
  const toRun = BOTS.filter((b) => target.has(b.key));
  if (toRun.length === 0) {
    console.error(`No bots matched. Active set: ${[...ACTIVE_KEYS].join(", ")}`);
    process.exit(1);
  }
  console.log(`Generating ${toRun.length} avatar(s): ${toRun.map((b) => b.key).join(", ")}`);
  for (const p of toRun) {
    const got = await generate(p, workingModel);
    if (got) workingModel = got;
  }
  console.log(workingModel ? `\nDone (model: ${workingModel}).` : "\nAll failed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
