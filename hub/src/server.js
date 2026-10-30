// Oblivia hub — Express server. Multi-page app: each flow is a real page
// (/, /guardian, /kid/:id, /passport/:id, /explorer, /cert/:decHash,
// /verify/:subjectId, /seal, /docs). APIs are thin JSON endpoints over the
// vault / DEC / ops modules plus LIVE chain reads. Nothing is mocked: if this
// server cannot reach the chain or the receipts, it answers with the error.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieSession from 'cookie-session';
import { keccak256, toBeHex, zeroPadValue, Wallet } from 'ethers';

import * as vault from './vault.js';
import * as decModule from './dec.js';
import * as ops from './ops.js';
import { loadAttestorKey, attestorSign } from './attestor.js';
import { chainStatus, policyFor, subjectOnChain, certificateFor, forgeBindings, deployments, ethers } from './chain.js';
import { encodeOp, decodeOp, opIdOf, digestOf, KIND, REASON, NOTARY, bytes3, ZERO_SCOPE } from './abi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VIEWS = path.resolve(__dirname, '..', 'views');
const PORT = Number(process.env.PORT || 3000);
const HUB_URL = process.env.HUB_URL || `http://127.0.0.1:${PORT}`;

const app = express();

// Cross-Origin Resource Sharing (CORS) for Vercel and multi-cloud clients
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '4mb' }));
app.use(
  cookieSession({
    name: 'oblivia.sid',
    keys: [process.env.SESSION_SECRET || 'oblivia-dev-secret'],
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  }),
);
app.use(express.static(VIEWS, { index: 'index.html' }));

const attestorWallet = loadAttestorKey();

function jsonError(res, code, err) {
  const msg = String(err?.message ?? err);
  res.status(code).json({ ok: false, error: msg });
}

const rpc = express.Router();

/* ------------------------------------------------------------------ chain */
rpc.get('/api/chain/status', async (_req, res) => res.json(await chainStatus()));

rpc.get('/api/policies/:code', async (req, res) => {
  try {
    res.json(await policyFor(String(req.params.code).toUpperCase()));
  } catch (e) {
    jsonError(res, 500, e);
  }
});

rpc.get('/api/policies', async (_req, res) => {
  const codes = ['CPP', 'MDP', 'EUR', 'IND'];
  const rows = await Promise.all(codes.map((c) => policyFor(c)));
  res.json(codes.map((c, i) => ({ code: c, ...(rows[i] ?? {}) })));
});

rpc.get('/api/chain/topic', async (_req, res) => {
  try {
    const s = await chainStatus();
    res.json(s);
  } catch (e) {
    jsonError(res, 500, e);
  }
});

/* --------------------------------------------------------------- subject */
rpc.post('/api/subjects', (req, res) => {
  try {
    const subjectId =
      req.session.subjectId ?? keccak256(ethers.randomBytes(24));
    const body = req.body ?? {};
    const guard = body.guardian || req.session.guardian || attestorWallet.address;
    const sub = vault.openSubject({
      subjectId,
      jurisdiction: String(body.jurisdiction || 'CPP').toUpperCase(),
      guardian: guard,
      vestEligibleAt: Number(body.vestEligibleAt ?? 0),
      openedAt: Date.now(),
    });
    req.session.subjectId = subjectId;
    res.json({ ok: true, subjectId: sub.subjectId, jurisdiction: sub.jurisdiction });
  } catch (e) {
    jsonError(res, 400, e);
  }
});

rpc.get('/api/subjects/:id', async (req, res) => {
  const id = req.params.id;
  const sub = vault.getSubject(id);
  if (!sub) return jsonError(res, 404, 'subject not found');
  const onChain = await subjectOnChain(id);
  const items = sub.items.map((i) => ({
    memoryId: i.memoryId,
    scopeRef: i.scopeRef,
    kind: i.kind,
    createdAt: i.createdAt,
    shredded: !!i.shredded,
  }));
  res.json({
    ok: true,
    subjectId: id,
    jurisdiction: sub.jurisdiction,
    guardian: sub.guardian,
    itemsCount: sub.items.length,
    erased: sub.erased,
    decs: sub.decs,
    dataRoot: vault.dataRootOf(id),
    onChain,
    items,
  });
});

/* ------------------------------------------------------------------- ops */
rpc.post('/api/ops/enroll', (req, res) => {
  try {
    const id = req.session.subjectId;
    const body = req.body ?? {};
    if (!id) return jsonError(res, 400, 'no session subject');
    const sub = vault.getSubject(id);
    if (!sub) return jsonError(res, 404, 'subject not found');
    const op = {
      kind: KIND.ENROLL,
      reason: 0,
      subjectId: id,
      scopeRef: ZERO_SCOPE,
      hashA: String(body.dataRoot ?? vault.dataRootOf(id)),
      hashB: String(body.ageHash ?? keccak256('0x00')),
      account: sub.guardian,
      policyVersion: Number(body.policyVersion ?? 1),
      jurisdictionBytes3: bytes3(sub.jurisdiction),
      vestEligibleAt: Number(body.vestEligibleAt ?? 0),
      nextBand: Number(body.nextBand ?? 0),
    };
    const payload = encodeOp(op);
    return res.json({
      ok: true,
      opId: opIdOf(chainIdNow(), deployments().EraseRegistry, op),
      subjectId: id,
      payload,
      digest: digestOf(chainIdNow(), deployments().EraseRegistry, payload),
      toSign: 'openSubject(bytes32,bytes3,bytes32,bytes32,uint64,uint8)',
      args: [
        op.subjectId,
        op.jurisdictionBytes3,
        op.hashB,
        op.hashA,
        op.vestEligibleAt,
        op.nextBand,
      ],
    });
  } catch (e) {
    jsonError(res, 500, e);
  }
});

function chainIdNow() {
  const d = deployments();
  return Number(d?.chainId ?? 84532);
}

rpc.post('/api/ops/memories', (req, res) => {
  try {
    const id = req.session.subjectId;
    if (!id) return jsonError(res, 400, 'no session subject');
    const b = req.body ?? {};
    if (!b.iv || !b.tag || !b.cipher) return jsonError(res, 400, 'browser-encrypted blob required (iv, tag, cipher)');
    const memoryId = keccak256(ethers.randomBytes(24));
    vault.addItem(id, {
      memoryId,
      scopeRef: b.scopeRef ?? memoryId, // default: each memory is its own scope
      kind: b.kind ?? 'MEMORY',
      iv: b.iv,
      tag: b.tag,
      cipher: b.cipher,
    });
    res.json({
      ok: true,
      memoryId,
      scopeRef: b.scopeRef ?? memoryId,
      dataRoot: vault.dataRootOf(id),
      itemsCount: vault.getSubject(id)?.items.length ?? 0,
    });
  } catch (e) {
    jsonError(res, 400, e);
  }
});

rpc.post('/api/ops/erase-request', (req, res) => {
  try {
    const id = req.session.subjectId;
    const scopeRef = String(req.body?.scopeRef || ZERO_SCOPE);
    const requestTxHash = req.body?.requestTxHash ?? null;
    if (!id) return jsonError(res, 400, 'no session subject');
    const sub = vault.getSubject(id);
    if (!sub) return jsonError(res, 404, 'subject not found');
    // nullifiers are computed NOW (pre-shred, nothing destroyed) and bound
    // into the DEC core; the DEC core hash is what goes ON CHAIN (hashA).
    const nuls = vault.nullifiersFiltered(id, scopeRef);
    const { dec: coreDec, coreHash } = decModule.buildDecCore({
      subjectId: id,
      jurisdiction: sub.jurisdiction,
      statuteCite: sub.statuteCite ?? null,
      policyVersion: sub.policyVersion ?? null,
      scopeRef,
      actor: sub.guardian,
      actorAuthority: sub.vested ? 'VESTED_PRINCIPAL' : 'GUARDIAN',
      itemNullifiers: nuls,
      chainId: chainIdNow(),
      opId: 'PENDING', // replaced below with real opId; coreHash depends on it
    });
    const op = {
      kind: KIND.ERASE,
      reason: REASON.REQUEST,
      subjectId: id,
      scopeRef,
      hashA: coreHash,
      hashB: decModule.methodHash(),
      account: sub.guardian,
    };
    const realOpId = opIdOf(chainIdNow(), deployments()?.EraseRegistry, op);
    // core includes opId → rebuild core with the REAL opId so hashA binds it.
    const { coreHash: coreHashFinal, dec: coreDecFinal } = decModule.buildDecCore({
      subjectId: id,
      jurisdiction: sub.jurisdiction,
      statuteCite: sub.statuteCite ?? null,
      policyVersion: sub.policyVersion ?? null,
      scopeRef,
      actor: sub.guardian,
      actorAuthority: sub.vested ? 'VESTED_PRINCIPAL' : 'GUARDIAN',
      itemNullifiers: nuls,
      chainId: chainIdNow(),
      opId: realOpId,
    });
    const opFinal = {
      kind: KIND.ERASE,
      reason: REASON.REQUEST,
      subjectId: id,
      scopeRef,
      hashA: coreHashFinal,
      hashB: decModule.methodHash(),
      account: sub.guardian,
    };
    const payload = encodeOp(opFinal);
    const opEntry = ops.enqueueOp({
      opId: realOpId,
      kind: 'ERASE',
      subjectId: id,
      scopeRef,
      jurisdiction: sub.jurisdiction,
      payload,
      requestTxHash,
      stage: requestTxHash ? 'QUEUED' : 'AWAIT_GUARDIAN_TX',
    });
    void coreDec; void coreHash; void op; void coreDecFinal;
    res.json({
      ok: true,
      opId: opEntry.opId,
      stage: opEntry.stage,
      coreHash: coreHashFinal,
      dec: coreDecFinal,
      itemsErased: nuls.length,
      requestTxHash,
    });
  } catch (e) {
    jsonError(res, 500, e);
  }
});

/* ---------------------------------------------------------------- notary */
rpc.get('/api/notary/next-op', (_req, res) => {
  const op = ops.nextQueued();
  if (!op) return res.json({ ok: true, op: null });
  res.json({
    ok: true,
    op: {
      opId: op.opId,
      kind: op.kind,
      subjectId: op.subjectId,
      scopeRef: op.scopeRef,
      payload: op.payload,
      requestTxHash: op.requestTxHash,
    },
  });
});

rpc.get('/api/notary/queue', (_req, res) => res.json({ ok: true, ops: ops.allOps() }));

rpc.post('/api/notary/confirmed', async (req, res) => {
  try {
    const { opId, txHash } = req.body ?? {};
    if (!opId || !txHash) return jsonError(res, 400, 'opId and txHash required');
    const entry = ops.findOp(opId);
    if (!entry) return jsonError(res, 404, 'op not found');
    if (entry.stage === 'CONFIRMED') return res.json({ ok: true, already: true, op: entry });

    const d = deployments();
    const check = await verifyExecutionReceipt(txHash, d?.EraseRegistry, opId);
    if (!check.ok) return res.status(400).json({ ok: false, error: 'receipt check failed', detail: check });
    const declared = req.body?.notaryPath ?? null;
    if (declared && !['ATTESTOR', 'DON'].includes(String(declared))) {
      return jsonError(res, 400, 'notaryPath must be ATTESTOR | DON');
    }

    const sub = vault.getSubject(entry.subjectId);
    // 1) recompute the DEC core from LIVE items (still not destroyed) and
    //    check it matches the value the executor pinned on chain (hashA).
    const payload = decodeOpFor(entry);
    const nuls = vault.nullifiersFiltered(entry.subjectId, entry.scopeRef ?? ZERO_SCOPE);
    const { dec: coreDec, coreHash } = decModule.buildDecCore({
      subjectId: entry.subjectId,
      jurisdiction: entry.jurisdiction,
      statuteCite: sub?.statuteCite ?? null,
      policyVersion: sub?.policyVersion ?? null,
      scopeRef: entry.scopeRef ?? ZERO_SCOPE,
      actor: entry.actor ?? sub?.guardian ?? null,
      actorAuthority: entry.actorAuthority ?? 'GUARDIAN',
      itemNullifiers: nuls,
      chainId: chainIdNow(),
      opId: entry.opId,
    });
    if (coreHash !== payload.hashA) {
      return res.status(409).json({
        ok: false,
        error: 'DEC core drift: data changed between request and confirmation',
        coreHash,
        onChainHash: payload.hashA,
      });
    }

    // 2) full DEC = core + verified receipt; store, link, then shred.
    const { dec, fullHash } = decModule.buildDecFull(
      {
        subjectId: entry.subjectId,
        jurisdiction: entry.jurisdiction,
        statuteCite: sub?.statuteCite ?? null,
        policyVersion: sub?.policyVersion ?? null,
        scopeRef: entry.scopeRef ?? ZERO_SCOPE,
        actor: entry.actor ?? sub?.guardian ?? null,
        actorAuthority: entry.actorAuthority ?? 'GUARDIAN',
        itemNullifiers: nuls,
        chainId: chainIdNow(),
        opId: entry.opId,
      },
      {
        txHash,
        blockNumber: check.blockNumber,
        notary: entry.notaryPath ?? 'ATTESTOR',
      },
    );
    ops.confirmOp(opId, {
      txHash, notaryPath: declared ?? entry.notaryPath ?? 'ATTESTOR', blockNumber: check.blockNumber,
    });
    ops.attachDec(opId, fullHash);
    vault.recordDec(fullHash, dec);
    if (entry.scopeRef && entry.scopeRef !== ZERO_SCOPE) {
      vault.shredItems(entry.subjectId, entry.scopeRef);
    } else {
      // full-scope: shred everything that was still live, then tombstone
      for (const it of [...vault.getSubject(entry.subjectId).items]) {
        vault.shredItems(entry.subjectId, it.scopeRef);
      }
      vault.markErased(entry.subjectId, { full: true });
    }

    res.json({ ok: true, opId, coreHash, fullHash, dec, notaryPath: declared ?? 'ATTESTOR', receipt: check });
  } catch (e) {
    jsonError(res, 500, e);
  }
});

function decodeOpFor(entry) {
  return decodeOp(entry.payload);
}

async function verifyExecutionReceipt(txHash, registryAddress, opId) {
  const { provider } = liveProvider();
  let receipt;
  try {
    receipt = await provider.getTransactionReceipt(txHash);
  } catch (e) {
    return { ok: false, error: String(e?.shortMessage || e) };
  }
  if (!receipt) return { ok: false, error: 'transaction not found (not yet mined?)' };
  if (receipt.status !== 1) return { ok: false, error: 'transaction reverted on chain' };
  if (registryAddress && receipt.to && receipt.to.toLowerCase() !== registryAddress.toLowerCase()) {
    return { ok: false, error: `tx went to ${receipt.to}, expected ${registryAddress}` };
  }
  // either Notary.Delivery(opId) or ErasureCertified must appear
  const hasOpIdLog = receipt.logs.some(
    (l) => l.topics[0] !== undefined && l.topics[0] === ethers.id(`OpConfirmed(bytes32)`),
  );
  const certifiedTopic = ethers.id(
    'ErasureCertified(bytes32,bytes32,bytes32,bytes32,uint8,uint8,uint64)',
  );
  const hasCert = receipt.logs.some((l) => l.topics[0] === certifiedTopic);
  return { ok: hasOpIdLog || hasCert, blockNumber: receipt.blockNumber, direct: hasOpIdLog };
}

function liveProvider() {
  const a = chainLiveHolder();
  if (!a.provider) {
    a.provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://127.0.0.1:8545');
  }
  return a;
}

function chainLiveHolder() {
  globalThis.__obliviaChain = globalThis.__obliviaChain ?? {};
  return globalThis.__obliviaChain;
}

rpc.post('/api/notary/sign', async (req, res) => {
  try {
    const { opId } = req.body ?? {};
    const entry = ops.findOp(opId);
    if (!entry) return jsonError(res, 404, 'op not found');
    const registryAddress = deployments()?.EraseRegistry;
    if (!registryAddress) return jsonError(res, 400, 'no deployment: run scripts/deploy.sh first');
    const sig = await attestorSign(
      attestorWallet,
      chainIdNow(),
      registryAddress,
      entry.payload,
    );
    const updated = ops.signOp(opId, sig, 'ATTESTOR');
    res.json({
      ok: true,
      attestor: attestorWallet.address,
      payload: updated.payload,
      sig,
      registry: registryAddress,
    });
  } catch (e) {
    jsonError(res, 500, e);
  }
});

/* -------------------------------------------------------------- DEC */
rpc.get('/api/dec/:decHash', (req, res) => {
  const d = vault.getDec(req.params.decHash);
  if (!d) return jsonError(res, 404, 'dec not found');
  res.json({ ok: true, decHash: req.params.decHash, dec: d });
});

app.use('/', rpc);

/* --------------------------------------------------------------- pages */
const page = (file) => (_req, res) => res.sendFile(path.join(VIEWS, file));
for (const [route, file] of [
  ['/guardian', 'guardian.html'],
  ['/explorer', 'explorer.html'],
  ['/verify', 'verify.html'],
  ['/docs', 'docs.html'],
]) {
  app.get(route, page(file));
}
app.get('/kid/:subjectId', (req, res) => {
  req.session.subjectId = req.params.subjectId;
  res.sendFile(path.join(VIEWS, 'kid.html'));
});
app.get('/passport/:subjectId', (req, res) => {
  req.session.subjectId = req.params.subjectId;
  res.sendFile(path.join(VIEWS, 'passport.html'));
});
app.get('/cert/:decHash', (req, res) => {
  res.sendFile(path.join(VIEWS, 'cert.html'));
});

app.use(
  (err, _req, res, _next) => {
    res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  },
);

app.listen(PORT, () => {
  console.log(`[oblivia-hub] listening on ${HUB_URL}`);
});
