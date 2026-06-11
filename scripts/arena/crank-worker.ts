// scripts/arena/crank-worker.ts
//
// Entry point for the dedicated arena-crank Railway worker (binding decision
// 2026-06-11: the crank does NOT run inside the Next.js web service).
//
// Railway setup: add a NEW worker service to the existing project pointing at
// this repo, start command `npm run arena:crank`, env vars:
//   ARENA_PROGRAM_ID        — deployed arena program id
//   ARENA_ER_ENDPOINT       — e.g. https://devnet.magicblock.app
//   ARENA_CRANK_KEYPAIR     — JSON array secret key for the crank signer
//   ARENA_CRANK_INTERVAL_MS — tick gap (default 2000)
//   ARENA_COMMIT_INTERVAL_MS— commit gap (default 300000)
//   DATABASE_URL            — Neon (crank lease)
//   DISABLE_ARENA_CRANK     — kill switch ("true" = no-op)
//
// Local run: npx tsx --env-file=.env.local scripts/arena/crank-worker.ts

import { startArenaCrank } from "@/lib/arena/crank";

startArenaCrank();

// Keep the worker alive; the crank loop owns all scheduling.
setInterval(() => {}, 1 << 30);
