#!/usr/bin/env bash
# Oblivia — part 1: local anvil + deploy + seed + ABI export
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/contracts"
export PATH="$PATH:$HOME/.config/.foundry/bin:$HOME/.foundry/bin"

if [ "${KEEP_ANVIL:-0}" != "1" ]; then
  anvil --port 8545 --block-time 1 > "$ROOT/hub/data/anvil.log" 2>&1 &
  export ANVIL_PID=$!
  for i in $(seq 1 40); do
    curl -s http://127.0.0.1:8545 >/dev/null 2>&1 && break
    sleep 0.5
  done
fi

if ! forge build 2>/dev/null; then
  echo "[run-local] forge build failed"; exit 1
fi

# hub attestor must exist BEFORE deploy so the chain registers ITS key
ATTESTOR=$(node --input-type=module -e "
import { loadAttestorKey } from '$ROOT/hub/src/attestor.js';
console.log(loadAttestorKey(process.env).address);
")
echo "[run-local] hub attestor: $ATTESTOR"
export ATTESTOR_ADDRESS="$ATTESTOR"
export RPC_URL=http://127.0.0.1:8545

forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast -vvv \
  > "$ROOT/hub/data/deploy.log" 2>&1 || { echo "[run-local] deploy failed; tail:"; tail -20 "$ROOT/hub/data/deploy.log"; exit 1; }
cp "$ROOT/contracts/deployments.json" "$ROOT/hub/deployments.json"
node "$ROOT/scripts/export-abi.mjs"
echo "[run-local] deployed. summary:"
node -e "
const d=require('$ROOT/hub/deployments.json');
for (const k of ['PolicyRegistry','EraseRegistry','Attestor','Forwarder']) console.log('  '+k+': '+d[k]);
console.log('  chainId: '+d.chainId);
"
