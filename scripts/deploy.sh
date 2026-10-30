#!/usr/bin/env bash
# Oblivia — testnet deploy (Base Sepolia or any EVM RPC).
#
# env: PRIVATE_KEY (burner wallet w/ faucet ETH), RPC_URL (defaults to Base Sepolia),
#      HUB_ATTESTOR_KEY if the hub key differs from the deployer — otherwise the
#      hub key is adopted from hub/.attestor.json (created on first run).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/contracts"
export PATH="$PATH:$HOME/.config/.foundry/bin"

RPC_URL="${RPC_URL:-https://sepolia.base.org}"
export RPC_URL

ATTESTOR=$(node --input-type=module -e "
import { loadAttestorKey } from '$ROOT/hub/src/attestor.js';
console.log(loadAttestorKey(process.env).address);
")
export ATTESTOR_ADDRESS

echo "[deploy] rpc       : $RPC_URL"
echo "[deploy] attestor  : $ATTESTOR"
echo "[deploy] forwarder : ${FORWARDER:-0x0000000000000000000000000000000000000000}"
echo "[deploy] private   : ${PRIVATE_KEY:+set}${PRIVATE_KEY:-<MISSING — export PRIVATE_KEY first>}"

if [ -z "${PRIVATE_KEY:-}" ]; then
  echo "[deploy] export PRIVATE_KEY (burner) first"
  exit 1
fi

forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast --verify \
  -e "ETHERSCAN_API_KEY=${ETHERSCAN_API_KEY:-}" > hub-deploy.log 2>&1 \
  || { echo "[deploy] failed; tail:"; tail -20 hub-deploy.log; exit 1; }

cp "$PWD/deployments.json" "$ROOT/hub/deployments.json"
node "$ROOT/scripts/export-abi.mjs"
echo "[deploy] done:"
node -e "
const d=JSON.parse(require('fs').readFileSync('$ROOT/hub/deployments.json'));
for (const k of ['PolicyRegistry','EraseRegistry','Attestor','Forwarder']) console.log('  '+k+': '+d[k]);
console.log('  chainId: '+d.chainId);
"
