#!/bin/bash
# Task 12 ER delegation harness — distilled from anchor-counter's
# fullstack-test.sh (magicblock-engine-examples @ e4bf31d, the PINS.md pin).
#
#   1. mb-test-validator on :8899 — base layer with the delegation + magic
#      programs preloaded (plain solana-test-validator has neither), plus the
#      devnet SOLUSD feed fixture at its real address.
#   2. @magicblock-labs/ephemeral-validator on :7799 — the local ER, remoting
#      to the base validator.
#   3. anchor-1.0.2 build + deploy, then ts-mocha tests/delegation.ts with
#      ARENA_DELEGATION_TEST=1 (the suite self-skips without it).
#
# Run from arena-program/:  ./scripts/test-delegation.sh
set -e
cd "$(dirname "$0")/.."

ANCHOR="$HOME/.avm/bin/anchor-1.0.2" # NEVER plain `anchor` (PATH has 0.31.1)
FEED_ADDR="ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu"
FEED_FIXTURE="tests/fixtures/solusd-feed.json"
MB_LOG=/tmp/arena-mb-validator.log
ER_LOG=/tmp/arena-ephemeral-validator.log

for bin in mb-test-validator ephemeral-validator; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "ERROR: $bin not installed (npm install -g @magicblock-labs/ephemeral-validator@latest)" >&2
    exit 1
  fi
done

# @magicblock-labs/ephemeral-validator 0.12.0 ships with two delegation-program
# account dumps MISSING from bin/local-dumps (packaging bug) — mb-test-validator
# hard-fails on them. They exist on devnet; fetch once if absent.
# api.devnet.solana.com is often degraded — override with ARENA_DEVNET_RPC
# (e.g. a Helius devnet URL) if the fetch times out.
DUMPS_DIR="$(npm root -g)/@magicblock-labs/ephemeral-validator/bin/local-dumps"
DEVNET_RPC="${ARENA_DEVNET_RPC:-https://api.devnet.solana.com}"
for acct in 9yvg9551MmE8mhWd88jAPLE3noTXHoopYG1BDhmtkCeR 7L9eCRv52UpGVePGj9P1zop8kzmh4SpYzYn6YhoAKHBg; do
  if [ ! -f "$DUMPS_DIR/$acct.json" ]; then
    echo "[setup] fetching missing local-dump $acct from devnet ..."
    solana account "$acct" --url "$DEVNET_RPC" --output json \
      --output-file "$DUMPS_DIR/$acct.json" >/dev/null \
      || { echo "ERROR: could not dump $acct (set ARENA_DEVNET_RPC to a healthy devnet RPC)" >&2; exit 1; }
  fi
done
for port in 8899 7799; do
  if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "ERROR: port $port already in use — stop the other validator first" >&2
    exit 1
  fi
done

MB_PID=""
ER_PID=""
cleanup() {
  [ -n "$ER_PID" ] && kill "$ER_PID" 2>/dev/null || true
  [ -n "$MB_PID" ] && kill "$MB_PID" 2>/dev/null || true
  pkill -f "ephemeral-validator" 2>/dev/null || true
  pkill -f "mb-test-validator" 2>/dev/null || true
  pkill -f "solana-test-validator" 2>/dev/null || true
  rm -rf test-ledger test-ledger-magicblock magicblock-test-storage 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[1/4] starting mb-test-validator (base layer) ..."
mb-test-validator --reset --account "$FEED_ADDR" "$FEED_FIXTURE" >"$MB_LOG" 2>&1 &
MB_PID=$!
for i in $(seq 1 90); do
  if ! kill -0 "$MB_PID" 2>/dev/null; then
    echo "ERROR: mb-test-validator exited early — see $MB_LOG" >&2
    exit 1
  fi
  slot=$(curl -s --max-time 1 -X POST -H "content-type: application/json" \
    -d '{"jsonrpc":"2.0","method":"getSlot","params":[{"commitment":"processed"}],"id":1}' \
    http://127.0.0.1:8899 2>/dev/null | sed -nE 's/.*"result":([0-9]+).*/\1/p')
  if [ -n "$slot" ] && [ "$slot" -gt 0 ]; then
    echo "      base validator producing slots (slot=$slot)"
    break
  fi
  [ "$i" -eq 90 ] && { echo "ERROR: base validator not ready in 90s — see $MB_LOG" >&2; exit 1; }
  sleep 1
done

echo "[2/4] starting ephemeral-validator (local ER) ..."
# pty wrapper: the validator's TUI exits silently without a controlling TTY
# (same workaround as fullstack-test.sh).
RUST_LOG=info python3 -c '
import pty, os, sys
status = pty.spawn([
    "ephemeral-validator",
    "--remotes", "http://127.0.0.1:8899",
    "--remotes", "ws://127.0.0.1:8900",
    "-l", "127.0.0.1:7799",
    "--reset",
    "--lifecycle", "ephemeral",
])
sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128 + os.WTERMSIG(status))
' </dev/null >"$ER_LOG" 2>&1 &
ER_PID=$!
for i in $(seq 1 60); do
  if curl -s --max-time 1 http://127.0.0.1:7799/health >/dev/null 2>&1; then
    echo "      ephemeral validator ready"
    break
  fi
  if ! kill -0 "$ER_PID" 2>/dev/null; then
    echo "ERROR: ephemeral-validator exited early — see $ER_LOG" >&2
    exit 1
  fi
  [ "$i" -eq 60 ] && { echo "ERROR: ephemeral-validator not ready in 60s — see $ER_LOG" >&2; exit 1; }
  sleep 1
done

export ANCHOR_WALLET="${HOME}/.config/solana/id.json"
export ANCHOR_PROVIDER_URL="http://127.0.0.1:8899"

echo "[3/4] build + deploy ..."
solana airdrop 100 "$(solana address -k "$ANCHOR_WALLET")" --url "$ANCHOR_PROVIDER_URL" >/dev/null
"$ANCHOR" build
"$ANCHOR" deploy --provider.cluster localnet --no-idl

echo "[4/4] running tests/delegation.ts ..."
ARENA_DELEGATION_TEST=1 \
  EPHEMERAL_PROVIDER_ENDPOINT="http://localhost:7799" \
  EPHEMERAL_WS_ENDPOINT="ws://localhost:7800" \
  npx ts-mocha -p ./tsconfig.json -t 1000000 --exit tests/delegation.ts
