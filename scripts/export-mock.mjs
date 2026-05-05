#!/usr/bin/env node
// Capture a /mock-style page from the running dev server and write an .mp4.
//
//   node scripts/export-mock.mjs                 # /mock → mock.mp4
//   node scripts/export-mock.mjs /mock           # explicit route
//   node scripts/export-mock.mjs /mock out.mp4   # custom output path
//
// Env overrides:
//   MOCK_BASE_URL   default http://localhost:3000
//   DURATION_MS     default 19000  (one 18s loop + 1s slack)
//   TRIM_MS         default 1000   (drop the first Nms — kills the white flash)
//   SCALE           default 2      (output multiplier vs. the 410×864 phone)
//   WIDTH HEIGHT    override the output dimensions directly
//   DPR             override the internal render scale (default = SCALE)
//
// Requires: ffmpeg in PATH, `npm i -D playwright` already run, and
// `npx playwright install chromium` to have downloaded the browser.

import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync, mkdirSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

const execFileP = promisify(execFile);

const ROUTE = process.argv[2] ?? "/mock";
const OUTPUT_ARG = process.argv[3];
const DEFAULT_NAME = ROUTE.replace(/^\/+/, "").replace(/\//g, "-") || "mock";
const OUTPUT = OUTPUT_ARG ?? `${DEFAULT_NAME}.mp4`;

const BASE_URL = process.env.MOCK_BASE_URL ?? "http://localhost:3000";
const DURATION_MS = Number(process.env.DURATION_MS ?? 19000);
const TRIM_MS = Number(process.env.TRIM_MS ?? 1500);

// Phone chassis is 410×864. Capture at viewport size so the phone fills
// the frame, then upscale to the requested output resolution in ffmpeg
// (lanczos). Playwright's screencast captures at logical viewport pixels
// regardless of deviceScaleFactor, so making recordVideo.size larger than
// the viewport just leaves the rest of the canvas empty.
const PHONE_W = 410;
const PHONE_H = 864;
const SCALE = Number(process.env.SCALE ?? 2);
const OUT_W = Number(process.env.WIDTH ?? PHONE_W * SCALE);
const OUT_H = Number(process.env.HEIGHT ?? PHONE_H * SCALE);
const DPR = Number(process.env.DPR ?? 2);
const VIEWPORT_W = PHONE_W;
const VIEWPORT_H = PHONE_H;

const TMP = path.join(process.cwd(), ".video-tmp");

async function checkFfmpeg() {
  try {
    await execFileP("ffmpeg", ["-version"]);
  } catch {
    console.error("✗ ffmpeg not found. Install: brew install ffmpeg");
    process.exit(1);
  }
}

async function main() {
  await checkFfmpeg();

  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  const url = `${BASE_URL}${ROUTE}`;
  console.log(`▶ Recording ${url}`);
  console.log(
    `  ${OUT_W}×${OUT_H} (viewport ${VIEWPORT_W}×${VIEWPORT_H} @${DPR}x) · ${DURATION_MS}ms · trim ${TRIM_MS}ms`,
  );

  // Default launch — chrome-headless-shell rejects --default-background-color
  // when combined with --remote-debugging-pipe, so we cover the page-load
  // flash by trimming the first frame range in ffmpeg instead.
  const browser = await chromium.launch();
  let exitCode = 0;
  try {
    const context = await browser.newContext({
      viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
      deviceScaleFactor: DPR,
      colorScheme: "dark",
      recordVideo: {
        dir: TMP,
        size: { width: VIEWPORT_W, height: VIEWPORT_H },
      },
    });
    const page = await context.newPage();

    try {
      const res = await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 15000,
      });
      if (!res || res.status() >= 400) {
        throw new Error(`HTTP ${res?.status() ?? "n/a"}`);
      }
    } catch (e) {
      console.error(`✗ Failed to load ${url}: ${e.message}`);
      console.error(`  Is the dev server running? Try: npm run dev`);
      await context.close();
      exitCode = 1;
      return;
    }

    // Let RAF + initial paint settle, then record the requested duration.
    await page.waitForTimeout(800);
    await page.waitForTimeout(DURATION_MS);
    await page.close();
    await context.close();
  } finally {
    await browser.close();
  }
  if (exitCode) process.exit(exitCode);

  const webms = readdirSync(TMP).filter((f) => f.endsWith(".webm"));
  if (webms.length !== 1) {
    console.error(
      `✗ Expected 1 .webm in ${TMP}, found ${webms.length}: ${webms.join(", ")}`,
    );
    process.exit(1);
  }
  const webmPath = path.join(TMP, webms[0]);

  console.log(`▶ Encoding → ${OUTPUT}`);
  const ffArgs = ["-y", "-i", webmPath];
  if (TRIM_MS > 0) {
    // Output-side seek: frame-accurate, drops the page-load lead-in.
    ffArgs.push("-ss", (TRIM_MS / 1000).toFixed(3));
  }
  if (OUT_W !== VIEWPORT_W || OUT_H !== VIEWPORT_H) {
    ffArgs.push("-vf", `scale=${OUT_W}:${OUT_H}:flags=lanczos`);
  }
  ffArgs.push(
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "slow",
    "-crf",
    "18",
    "-movflags",
    "+faststart",
    OUTPUT,
  );
  await execFileP("ffmpeg", ffArgs);

  rmSync(TMP, { recursive: true, force: true });
  console.log(`✓ ${OUTPUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
