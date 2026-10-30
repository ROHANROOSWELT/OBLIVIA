// Oblivia hub — notary queue (the junction between guardian intents and
// executors). Every lifecycle op that reached the point of being applied on
// chain is persisted here BEFORE any signature/tx exists (stage
// AWAIT_GUARDIAN_TX) and re-staged as it flows through executors:
//
//   AWAIT_GUARDIAN_TX  -> guardian direct wallet tx (open/add/request) pending
//   QUEUED             -> payload ready; waiting for a notary executor
//   DON_SENT           -> CRE runtime.report delivered via onReport()
//   ATTESTED           -> hub key signed + sent notarize()
//   CONFIRMED          -> on-chain receipt seen; DEC may be issued
//
// Executors: CRE workflow (polls GET /api/notary/next-op) OR the hub's
// own attestor worker when CRE is not available. Nothing is faked: a CONFIRMED
// row always carries a real txHash.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.resolve(__dirname, '..');
const OPS_FILE = path.join(HUB_ROOT, 'data', 'ops.json');

let opsState = null;

function empty() {
  return { seq: 1, ops: [] };
}

function load() {
  if (opsState !== null) return opsState;
  fs.mkdirSync(path.dirname(OPS_FILE), { recursive: true });
  if (fs.existsSync(OPS_FILE)) {
    opsState = JSON.parse(fs.readFileSync(OPS_FILE, 'utf8'));
  } else {
    opsState = empty();
    save();
  }
  return opsState;
}

function save() {
  const tmp = OPS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(opsState, null, 2));
  fs.renameSync(tmp, OPS_FILE);
}

export function findOp(opId) {
  return load().ops.find((o) => o.opId === opId) ?? null;
}

export function allOps() {
  return [...load().ops].reverse();
}

/**
 * Enqueue an op. payload = hex of abi.encode(Op). sig may be null (for the
 * DON path where the workflow signs inside the CRE runtime, or for ATT after
 * the hub attestor signs and re-posts via signOp()).
 */
export function enqueueOp(entry) {
  const state = load();
  const op = {
    opId: entry.opId,
    kind: entry.kind,
    subjectId: entry.subjectId,
    scopeRef: entry.scopeRef ?? null,
    jurisdiction: entry.jurisdiction ?? null,
    payload: entry.payload, // hex
    sig: entry.sig ?? null,
    requestTxHash: entry.requestTxHash ?? null,
    stage: entry.stage ?? 'QUEUED',
    notaryPath: entry.notaryPath ?? null,
    txHash: entry.txHash ?? null,
    decHash: entry.decHash ?? null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    log: [],
  };
  state.ops.push(op);
  save();
  return op;
}

/** Guardian direct tx observed: promote the op so executors can pick it up. */
export function promoteAfterGuardianTx(opId, requestTxHash) {
  const op = findOrThrow(opId);
  if (requestTxHash) op.requestTxHash = requestTxHash;
  op.stage = 'QUEUED';
  op.updatedAt = Date.now();
  op.log.push({ at: Date.now(), event: 'GUARDIAN_TX_OBSERVED', txHash: requestTxHash ?? null });
  save();
  return op;
}

/** Next QUEUED op for an executor (peek, does not lock; op-level idempotence is the opId replay guard). */
export function nextQueued() {
  return load().ops.find((o) => o.stage === 'QUEUED') ?? null;
}

export function signOp(opId, sig, notaryPath) {
  const op = findOrThrow(opId);
  op.sig = sig;
  op.notaryPath = notaryPath;
  op.stage = notaryPath === 'DON' ? 'DON_SENT' : 'ATTESTED';
  op.updatedAt = Date.now();
  op.log.push({ at: Date.now(), event: notaryPath === 'DON' ? 'DON_REPORT' : 'ATTESTED', notaryPath });
  save();
  return op;
}

export function confirmOp(opId, { txHash, notaryPath, blockNumber }) {
  const op = findOrThrow(opId);
  op.stage = 'CONFIRMED';
  op.txHash = txHash;
  op.notaryPath = notaryPath ?? op.notaryPath;
  if (blockNumber != null) op.blockNumber = blockNumber;
  op.updatedAt = Date.now();
  op.log.push({ at: Date.now(), event: 'CONFIRMED', txHash, blockNumber });
  save();
  return op;
}

export function attachDec(opId, decHash) {
  const op = findOrThrow(opId);
  op.decHash = decHash;
  op.updatedAt = Date.now();
  save();
  return op;
}

export function findOrThrow(opId) {
  const op = findOp(opId);
  if (!op) throw new Error('op not found: ' + opId);
  return op;
}
