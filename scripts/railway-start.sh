#!/usr/bin/env bash
# Railway per-service start launcher. Every service shares this repo + railway.json,
# so we branch on the auto-injected RAILWAY_SERVICE_NAME to pick the right process.
#   arena-llm-operator -> the LLM oracle-bot brain loop (drives apply_decision)
#   <anything else>    -> the Next.js web app (perps-arena / gwak.gg)
set -euo pipefail

case "${RAILWAY_SERVICE_NAME:-web}" in
  arena-llm-operator)
    echo "[railway-start] LLM operator worker"
    exec npx tsx scripts/arena/llm-operator-worker.ts
    ;;
  *)
    echo "[railway-start] Next.js web server"
    exec env HOSTNAME=0.0.0.0 node .next/standalone/server.js
    ;;
esac
