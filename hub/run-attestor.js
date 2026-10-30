// Oblivia hub — ATTESTOR-path executor CLI (fallback when CRE is not set up).
// Polls /api/notary/next-op; for each QUEUED ERASE op it:
//   1. asks the hub to sign the payload with the hub attestor key,
//   2. sends `notarize(payload, sig)` from the hub's own wallet (any wallet
//      can do this — the contract verifies the hub key's signature),
//   3. waits for a real receipt and posts it to /api/notary/confirmed so the
//      hub can issue the DEC and shred.
// Requires PRIVATE_KEY (the SENDER; defaults to the hub attestor key) and
// RPC_URL pointing at the deployed network.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { loadAttestorKey } from './src/attestor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.resolve(__dirname);
const HUB_URL = process.env.HUB_URL || 'http://127.0.0.1:3000';
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';

function deployments() {
  const f = path.join(HUB_ROOT, 'deployments.json');
  if (!fs.existsSync(f)) throw new Error('deployments.json missing — run scripts/deploy.sh first');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

const REGISTRY_ABI = [
  'function notarize(bytes payload, bytes sig)',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const deploy = deployments();
  const attestor = loadAttestorKey();
  const senderPk = process.env.PRIVATE_KEY ?? attestor.privateKey;
  const sender = new ethers.Wallet(senderPk, new ethers.JsonRpcProvider(RPC_URL));
  const registry = new ethers.Contract(deploy.EraseRegistry, REGISTRY_ABI, sender);

  console.log(`[attestor-exec] hub=${HUB_URL} rpc=${RPC_URL} registry=${deploy.EraseRegistry}`);
  console.log(`[attestor-exec] signer=${sender.address}`);

  while (true) {
    try {
      const res = await fetch(`${HUB_URL}/api/notary/next-op`);
      const { op } = await res.json();
      if (!op) { await sleep(700); continue; }

      console.log(`[attestor-exec] ${new Date().toISOString()} op ${op.opId.slice(0, 10)}… signing`);
      const sigRes = await fetch(`${HUB_URL}/api/notary/sign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ opId: op.opId }),
      });
      const signed = await sigRes.json();
      if (!signed.ok) throw new Error('sign failed: ' + JSON.stringify(signed));

      let txHash = null;
      if (process.env.FORWARD_ONLY === '1') {
        console.log('[attestor-exec] FORWARD_ONLY — payload+sig handed to the /seal page:');
        console.log(`  payload: ${signed.payload}`);
        console.log(`  sig:     ${signed.sig}`);
        continue;
      }
      const tx = await registry.notarize(signed.payload, signed.sig);
      const receipt = await tx.wait(1);
      if (receipt.status !== 1) throw new Error('notarize reverted');
      txHash = receipt.hash;
      console.log(`[attestor-exec] notarize mined: ${txHash}`);

      const conf = await fetch(`${HUB_URL}/api/notary/confirmed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ opId: op.opId, txHash: txHash ?? signed.sig, notaryPath: 'ATTESTOR' }),
      });
      const confJson = await conf.json();
      if (!confJson.ok && !confJson.already) throw new Error('confirm failed: ' + JSON.stringify(confJson));
      console.log(`[attestor-exec] confirmed. DEC: ${confJson.coreHash ?? 'n/a'}`);
    } catch (e) {
      console.error('[attestor-exec]', e.message ?? e);
      await sleep(2000);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
