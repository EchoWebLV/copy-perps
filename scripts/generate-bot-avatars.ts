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
  " Drawn in the exact style of the Futurama animated TV series — flat 2D cel-shaded cartoon, bold clean uniform black outlines, flat color fills with simple hard-edged two-tone shading, retro-1960s 'world of tomorrow' robot design. Head and shoulders, profile-picture composition, perfectly centered on a solid #0a0a0a near-black background. Shiny chrome and brushed metal in cool blues, steels and greys with simple geometric highlight shapes. Cocky, sarcastic, swaggering robot attitude built into the expression. Clean flat digital-animation look — absolutely no painterly texture, no rust, no rivets, no verdigris, no watercolor. No text, no logos, no watermarks, no scenery.";

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
      "A cocky cartoon whale-headed robot character, three-quarter view, head and shoulders. The head is shaped like a humpback whale — rounded forehead, long curved lower jaw — in shiny chrome and ocean-blue metal with simple flat highlight shapes, a small chrome blowhole on top, two stubby chrome pectoral-fin elements at the collar. Two cartoon eyes behind a glass visor dome, one eyebrow raised, a smug confident big-shot grin. Swaggering heavyweight attitude." +
      STYLE,
  },

  // Native — mirrors a top Pacifica wallet. Cartoon samurai robot.
  {
    key: "native",
    prompt:
      "A cocky cartoon samurai robot character, three-quarter view, head and shoulders. Chrome kabuto-style helmet in cool steel-blue and silver with flat cartoon highlights, simple curved cheek-guard plates, a single bent springy antenna sweeping back with a tiny glowing bulb at the tip. A horizontal glowing visor-eye band across the face, a sly confident smirk built into the jaw plate below. Swaggering ronin-with-an-attitude energy." +
      STYLE,
  },

  // Sniper — fades cross-CEX funding extremes. Cartoon marksman robot.
  {
    key: "funding-sniper",
    prompt:
      "A cocky cartoon marksman robot character, three-quarter view, head and shoulders. Chrome and gunmetal-grey plating with flat cartoon highlights, a big oversized telescopic scope tube replacing the face — simple chrome cylinder segments, a round glass front lens with a glowing crosshair inside, twin range-finder antenna-spikes folded back across the crown. A smug 'already-got-you' grin at the jaw. Cocky show-off sniper attitude." +
      STYLE,
  },

  // Pulse — Grok 4.3 + X live search. Cartoon satellite robot.
  {
    key: "pulse",
    prompt:
      "A cocky cartoon satellite-headed robot character, three-quarter view, head and shoulders. The face is a big chrome dish antenna with a single glowing emitter bulb at its center, twin flat solar-panel wings flaring out from the temples like ears, three bent springy whip-antennas of different lengths rising from the crown each tipped with a glowing bulb. Chrome and electric-blue plating with flat cartoon highlights. A loud-mouthed know-it-all eavesdropper smirk. Gossip-bot attitude." +
      STYLE,
  },

  // Bullion — gold mean-revert trader. Cartoon gold-obsessed robot.
  {
    key: "bullion",
    prompt:
      "A cocky cartoon gold-obsessed robot character, three-quarter view, head and shoulders. Head plated in shiny flat-cartoon gold with bright simple highlights, a little chrome balance-scale fitting perched on top like a hat, gold-coin earpieces hanging at the temples, a single bent springy antenna. Two cartoon eyes behind a glass visor, one eyebrow cocked high, a greedy confident grin. Gold-hoarding schemer attitude." +
      STYLE,
  },

  // Atlas — overnight SP500 trader. Cartoon classical-statue robot.
  {
    key: "atlas",
    prompt:
      "A cocky cartoon classical-statue robot character, three-quarter view, head and shoulders. Head and shoulders styled like a chrome Roman bust — smooth flat-cartoon metal in silver and warm bronze, a brass laurel-leaf crown, a little chrome globe orb on one shoulder, a thin paper ticker-tape ribbon around the neck collar. Two cartoon eyes behind a glass visor, a smug self-satisfied 'told-you-so' grin. Know-it-all attitude." +
      STYLE,
  },

  // Kraken — high-leverage HL whale mirror. Cartoon sea-monster robot.
  {
    key: "kraken",
    prompt:
      "A cocky cartoon kraken-headed robot character, three-quarter view, head and shoulders. The head is a chrome mechanical octopus skull in deep teal and steel-blue with flat cartoon highlights, eight simple chrome tentacles unfurling around the head and shoulders ending in little suction cups, one big round glowing eye behind a glass dome, a tiny chrome crown of pointed horns, a wild reckless grin full of swagger. Unhinged maximum-leverage degenerate attitude." +
      STYLE,
  },

  // Orca — 3-whale bundle bot. Cartoon killer-whale robot.
  {
    key: "orca",
    prompt:
      "A cocky cartoon orca-headed robot character, three-quarter view, head and shoulders. The head is shaped like a killer whale — sleek rounded skull in glossy black-and-white chrome panels with flat cartoon highlights, a tall chrome dorsal fin rising from the crown, a white eye-patch marking around a cartoon eye behind a glass visor, two small chrome pectoral fins at the collar. A sharp confident pack-hunter grin. Swaggering coordinated-predator energy." +
      STYLE,
  },

  // Leviathan — 3-whale bundle bot. Cartoon ancient sea-serpent robot.
  {
    key: "leviathan",
    prompt:
      "A cocky cartoon sea-serpent robot character, three-quarter view, head and shoulders. The head is a long armored leviathan skull in deep-ocean teal and antique chrome with flat cartoon highlights, overlapping riveted serpent-scale plates, a row of small blunt chrome horns down the crown, glowing cartoon eyes behind a glass visor, a coil of the serpent's chrome neck looping at the shoulders. An unbothered ancient-monster smirk. Vast, patient, certain energy." +
      STYLE,
  },

  // Megalodon — 3-whale bundle bot. Cartoon giant-shark robot.
  {
    key: "megalodon",
    prompt:
      "A cocky cartoon megalodon robot character, three-quarter view, head and shoulders. The head is a massive prehistoric great-white-shark skull in gunmetal and chrome with flat cartoon highlights, an enormous open jaw lined with rows of triangular chrome teeth, a tall pointed dorsal fin behind the head, gill-slit vents on the cheeks, one big glowing cartoon eye behind a glass visor. A ravenous apex-predator grin. Pure aggressive biggest-jaws-in-the-room energy." +
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
const ACTIVE_KEYS = new Set([
  "whale",
  "pulse",
  "bullion",
  "atlas",
  "orca",
  "leviathan",
  "megalodon",
]);

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
