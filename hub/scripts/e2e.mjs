// hub/scripts/e2e.mjs — pipeline validation driving the EXACT endpoints the
// MPA pages use, plus the exact wallet-tx semantics (guardian = anvil key #0
// in this harness; the browser UI does the same with MetaMask).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.resolve(__dirname, '..');
const ROOT = path.resolve(HUB_ROOT, '..');
const HUB_URL = process.env.HUB_URL || 'http://127.0.0.1:3000';
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const REG_ABI = JSON.parse(fs.readFileSync(path.join(HUB_ROOT, 'views', 'assets', 'eraseregistry-abi.json'), 'utf8'));

const deploy = JSON.parse(fs.readFileSync(path.join(HUB_ROOT, 'deployments.json'), 'utf8'));
const provider = new ethers.JsonRpcProvider(RPC_URL);
const GUARDIAN_PK =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // anvil #0
const guardian = new ethers.Wallet(GUARDIAN_PK, provider);
const reg = new ethers.Contract(deploy.EraseRegistry, REG_ABI, guardian);

const get = async (u) => (await fetch(HUB_URL + u)).json();
const post = async (u, b) => (await fetch(HUB_URL + u, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}),
})).json();

// cookie jar (cookie-session splits state + sig across two Set-Cookie rows)
let cookie = null;
function jarSet(res) {
  const set = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')];
  const parts = [];
  for (const row of set) {
    if (!row) continue;
    parts.push(row.split(';')[0]);
  }
  if (parts.length) cookie = parts.join('; ');
}
async function jar(res) {
  jarSet(res);
  return res.json();
}
const cgetJson = async (u) => jar(await fetch(HUB_URL + u, { headers: { cookie: cookie ?? '' } }));
const cpostJson = async (u, b) => jar(await fetch(HUB_URL + u, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie ?? '' }, body: JSON.stringify(b ?? {}),
}));

async function main() {
  console.log('e2e: hub', HUB_URL, 'registry', deploy.EraseRegistry);

  // 0. status
  const st = await get('/api/chain/status');
  if (!st.ok) throw new Error('chain down: ' + st.error);
  console.log('  chain head', st.blockNumber);

  // 1. subject create (hub-local) — like the guardian page does first
  const created = await cpostJson('/api/subjects', {
    jurisdiction: 'CPP',
    guardian: guardian.address, // the real on-chain guardian
  });
  if (!created.ok) throw new Error('subjects: ' + JSON.stringify(created));
  const subjectId = created.subjectId;
  console.log('  subject', subjectId);

  // 2. memory commit (encrypted blob posted, then guardian wallet tx addMemory)
  const iv = '0x' + 'a1'.repeat(12);
  const tag = '0x' + 'b2'.repeat(16);
  const cipher = '0x' + 'c3'.repeat(24);
  const mem = await cpostJson('/api/ops/memories', { iv, tag, cipher });
  if (!mem.ok) throw new Error('memories: ' + JSON.stringify(mem));
  console.log('  memory', mem.memoryId, 'dataRoot', mem.dataRoot);

  // 3. enroll on chain from the guardian wallet (openSubject)
  const enroll = await cpostJson('/api/ops/enroll', {}); // uses session subject
  if (!enroll.ok) throw new Error('enroll payload: ' + JSON.stringify(enroll));
  console.log('  enroll payload ready; opId', enroll.opId.slice(0, 10));
  const b3 = ethers.zeroPadValue(ethers.hexlify(ethers.toUtf8Bytes('CPP')), 3);
  const txOpen = await reg.openSubject(
    subjectId,
    b3,
    ethers.id('GUARDIAN_DECLARATION@v1:' + guardian.address),
    ethers.keccak256(ethers.toUtf8Bytes('dataRootProbe')),
    Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
    2,
  );
  await txOpen.wait(1);
  console.log('  openSubject tx', txOpen.hash);

  // 4. guardian requestErasure (FULL) on chain + hub enqueue
  const txReq = await reg.requestErasure(subjectId, '0x' + '00'.repeat(32));
  await txReq.wait(1);
  const erq = await cpostJson('/api/ops/erase-request', {
    scopeRef: '0x' + '00'.repeat(32),
    requestTxHash: txReq.hash,
  });
  if (!erq.ok) throw new Error('erase-request: ' + JSON.stringify(erq));
  console.log('  erase op queued', erq.opId.slice(0, 10), 'coreHash', erq.coreHash.slice(0, 10));

  // 5. attestor path: hub signs, "executor" (this harness) sends notarize tx
  const sign = await cpostJson('/api/notary/sign', { opId: erq.opId });
  if (!sign.ok) throw new Error('sign: ' + JSON.stringify(sign));
  console.log('  sig', sign.sig.slice(0, 12), 'attestor', sign.attestor);
  const sender = new ethers.Wallet(deploy.AttestorPk ?? GUARDIAN_PK, provider);
  const regSender = new ethers.Contract(deploy.EraseRegistry, REG_ABI, sender);
  const txN = await regSender.notarize(sign.payload, sign.sig);
  const rcN = await txN.wait(1);
  if (rcN.status !== 1) throw new Error('notarize reverted');
  console.log('  notarize tx', rcN.hash);

  // 6. confirm → hub burns nullifiers + issues DEC
  const conf = await cpostJson('/api/notary/confirmed', {
    opId: erq.opId, txHash: rcN.hash, notaryPath: 'ATTESTOR',
  });
  if (!conf.ok) throw new Error('confirm: ' + JSON.stringify(conf));
  console.log('  DEC fullHash', conf.fullHash);

  // 7. verify certificate independently
  const vr = await cgetJson('/api/dec/' + conf.fullHash);
  if (!vr.ok) throw new Error('dec not found');
  console.log('  dec type', vr.dec.type, 'items erased', vr.dec.itemsErased);

  // 8. subject now has items shredded
  const after = await cgetJson('/api/subjects/' + subjectId);
  console.log('  subject after: itemsCount', after.itemsCount, 'erased', after.erased);

  console.log('\nE2E OK');
}

main().catch((e) => {
  console.error('\nE2E FAILED:', e.message || e);
  process.exit(1);
});
