// Record the gwak mockup as a 9:16 mp4. Zero npm deps: uses Node's built-in
// WebSocket + fetch to drive Chrome's DevTools screencast, then ffmpeg to encode.
//
//   node pitch/record.mjs                 -> pitch/gwak-9x16.mp4 (720x1280, ~11s)
//   node pitch/record.mjs 1080 19         -> 1080x1920, 19s
//
// Requires: Google Chrome + ffmpeg on PATH (both already installed here).

import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const ROOT = process.cwd();
const WIDTH = Number(process.argv[2]) || 1440;         // 1440x2560 — more pixels inside the phone
const HEIGHT = Math.round((WIDTH * 16) / 9);
const SECONDS = Number(process.argv[3]) || 12;         // = one loop period (matches the page clock)
const PORT = 9333;
const FRAMES = "/tmp/gwakframes";
const PAGE = process.env.PAGE || "gwak-mockup.html";   // PAGE=gwak-pulse.html node pitch/record.mjs
const OUT = `${ROOT}/pitch/${PAGE.replace(/\.html$/, "")}-9x16.mp4`;
const URL = `file://${ROOT}/pitch/${PAGE}?fill`;

rmSync(FRAMES, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

console.log(`▶ launching Chrome ${WIDTH}x${HEIGHT}, recording ${SECONDS}s ...`);
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORT}`,
  "--hide-scrollbars",
  "--disable-gpu",
  "--force-device-scale-factor=1",
  `--window-size=${WIDTH},${HEIGHT}`,
  URL,
], { stdio: "ignore" });

// find the page's devtools websocket
let wsUrl;
for (let i = 0; i < 60; i++) {
  try {
    const tabs = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    const page = tabs.find((t) => t.type === "page");
    if (page?.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
  } catch { /* not up yet */ }
  await sleep(200);
}
if (!wsUrl) { chrome.kill(); throw new Error("Chrome devtools never came up"); }

const ws = new WebSocket(wsUrl);
let id = 0;
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
const frames = [];

await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Page.screencastFrame") {
    frames.push({ data: msg.params.data, t: msg.params.metadata.timestamp });
    send("Page.screencastFrameAck", { sessionId: msg.params.sessionId });
  }
};

send("Page.enable");
await sleep(500); // let fonts + first paint settle
send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1, maxWidth: WIDTH, maxHeight: HEIGHT });
await sleep(SECONDS * 1000);
send("Page.stopScreencast");
await sleep(250);
ws.close();
chrome.kill();

if (frames.length < 5) throw new Error(`only got ${frames.length} frames`);
console.log(`✓ captured ${frames.length} frames, encoding ...`);

// write frames + a concat list using each frame's REAL timestamp delta, so
// playback pacing matches the page exactly (screencast frames are uneven).
const t0 = frames[0].t;
let list = "";
for (let i = 0; i < frames.length; i++) {
  const name = `${FRAMES}/f${String(i).padStart(5, "0")}.jpg`;
  writeFileSync(name, Buffer.from(frames[i].data, "base64"));
  const dur = i < frames.length - 1
    ? Math.max(0.001, frames[i + 1].t - frames[i].t)
    : 1 / 30;
  list += `file '${name}'\nduration ${dur.toFixed(4)}\n`;
}
list += `file '${FRAMES}/f${String(frames.length - 1).padStart(5, "0")}.jpg'\n`;
writeFileSync(`${FRAMES}/list.txt`, list);
console.log(`encoding ${frames.length} frames over ${(frames.at(-1).t - t0).toFixed(1)}s (real timing) ...`);
execFileSync("ffmpeg", [
  "-y",
  "-f", "concat", "-safe", "0", "-i", `${FRAMES}/list.txt`,
  // real timing -> resample to a clean constant 30fps; lock to an exact 9:16 frame
  "-vf", `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0x000000,fps=30`,
  "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  OUT,
], { stdio: "inherit" });

console.log(`\n✅ done -> ${OUT}`);
