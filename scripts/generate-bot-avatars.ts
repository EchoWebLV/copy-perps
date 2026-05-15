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
  " Hand-painted illustrated robot character bust in the style of Machinarium by Amanita Design — head and shoulders, profile-picture composition, perfectly centered on a solid #0a0a0a near-black background. Aged rusty copper and brass plating with visible rivets, bolts, weathered patina and verdigris, exposed bundles of copper wire and tarnished tubing, riveted metal panels with peeling old paint. Big round expressive light-bulb eyes that glow warmly. Charmingly wonky asymmetric proportions, faint hand-drawn ink outlines, watercolor texture, painterly brush strokes, soft warm shadows. Melancholic-but-lovable adventure-game character energy. No text, no logos, no watermarks, no scenery.";

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

  // Whale — mirrors a real Hyperliquid whale. Mechanical whale character.
  {
    key: "whale",
    prompt:
      "A charmingly wonky mechanical whale-headed robot character, three-quarter view, head and shoulders. The head is shaped like a humpback whale — rounded forehead, long curved lower jaw, made of riveted patchwork copper and weathered brass plates with deep-blue oxidation streaks suggesting the sea, a small dented chrome blowhole on top puffing a wisp of steam, copper-wire baleen tendrils hanging from the jaw, two tiny bent-brass pectoral-fin elements riveted at the collar. One enormous round single light-bulb eye on the side of the head glowing warm amber, a tiny ship-porthole window on the temple. Gentle giant melancholic expression." +
      STYLE,
  },

  // Native — mirrors a top Pacifica wallet. Steampunk samurai ronin.
  {
    key: "native",
    prompt:
      "A charmingly wonky steampunk-samurai robot character, three-quarter view, head and shoulders. Aged bronze and copper kabuto-style helmet with rivets, weathered verdigris-green oxidation streaks running along the seams, riveted samurai cheek-guard plates flaring out, a small brass topknot antenna sweeping back with a tiny glowing amber bulb at its tip, two small bronze flag-fins on the temples. One horizontal slit-eye visor glowing warm orange across the face, faint ink lines on the armor. Calm warrior-pride expression." +
      STYLE,
  },

  // Sniper — fades cross-CEX funding extremes. Steampunk marksman.
  {
    key: "funding-sniper",
    prompt:
      "A charmingly wonky steampunk marksman robot character, three-quarter view, head and shoulders. Aged olive-bronze and copper plating with weathered rivets, hexagonal hammered-metal cheek guards, a giant oversized brass spyglass / monocle telescope tube replacing the face — multiple telescoping segments with rivet bands, an amber glass front lens with a thin glowing crosshair etched inside, twin brass range-finder antenna-spikes folded back across the crown, a small leather comms patch on one temple, frayed copper ghillie-strand wires draped over the shoulder collar. Quiet patient stillness." +
      STYLE,
  },

  // Pulse — Grok 4.3 + X live search. Steampunk satellite robot.
  {
    key: "pulse",
    prompt:
      "A charmingly wonky steampunk satellite-headed robot character, three-quarter view, head and shoulders. The face is a large dented copper-and-brass dish antenna replacing where eyes and mouth would be — a riveted bowl shape with a single glowing warm-amber emitter bulb at the dish center, twin hammered-brass solar-panel wings flaring out from the temples like ears with patches of verdigris-green oxidation, three thin brass whip-antennas of varying lengths rising from the crown each tipped with a tiny glowing copper bulb, faint sound-wave ripples etched into the collar plate. Always-listening eccentric eavesdropper energy." +
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
