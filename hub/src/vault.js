// Oblivia hub — encrypted storage plane. The hub NEVER sees plaintext:
// the guardian's browser encrypts memory payloads (WebCrypto AES-256-GCM,
// key derived from the guardian's local passphrase) and only ever posts
// {iv, tag, ciphertext} hex. This module persists those blobs and computes
// the deterministic data-root commitments the guardian pins on chain.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, toBeHex } from 'ethers';
import { ZERO_SCOPE } from './abi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.resolve(__dirname, '..');
const DB_DIR = path.join(HUB_ROOT, 'data');
const DB_FILE = path.join(DB_DIR, 'vault.json');

let db = null;

function emptyDb() {
  return { subjects: {}, decs: {}, chain: {} };
}

export function loadDb() {
  if (db !== null) return db;
  fs.mkdirSync(DB_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    db = emptyDb();
    saveDb();
  }
  return db;
}

export function saveDb() {
  if (db === null) return;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export function openSubject(subject) {
  const d = loadDb();
  if (d.subjects[subject.subjectId]) throw new Error('subject already opened');
  d.subjects[subject.subjectId] = {
    subjectId: subject.subjectId,
    jurisdiction: subject.jurisdiction,
    guardian: subject.guardian,
    ageBand: subject.ageBand ?? null,
    policyVersion: subject.policyVersion ?? null,
    openedAt: subject.openedAt ?? Date.now(),
    vestEligibleAt: subject.vestEligibleAt ?? null,
    items: subject.items ?? [],
    erased: false,
    erasedAt: null,
    decs: [],
  };
  saveDb();
  return d.subjects[subject.subjectId];
}

export function getSubject(subjectId) {
  return loadDb().subjects[subjectId] ?? null;
}

export function addItem(subjectId, item) {
  const sub = requireActive(subjectId);
  sub.items.push({
    memoryId: item.memoryId,
    scopeRef: item.scopeRef,
    kind: item.kind ?? 'MEMORY',
    iv: item.iv,
    tag: item.tag,
    cipher: item.cipher,
    createdAt: Date.now(),
  });
  saveDb();
  return sub.items[sub.items.length - 1];
}

export function itemsOf(subjectId) {
  return getSubject(subjectId)?.items ?? [];
}

/**
 * Deterministic commitment over the full current memory tree.
 * dataRoot = keccak256( concat( keccak256(iv||tag||cipher) for each sorted item ) ).
 * The guardian EIP-712-signs an over this root and it is pinned on chain as
 * dataRootCommitment — later provable data-shredding keys off the same root.
 */
function strip0x(hex) {
  return String(hex ?? '').replace(/^0x/i, '');
}

export function dataRootOf(subjectId) {
  const items = [...itemsOf(subjectId)].sort((a, b) =>
    a.memoryId < b.memoryId ? -1 : a.memoryId > b.memoryId ? 1 : 0,
  );
  const parts = items.map((i) =>
    keccak256('0x' + strip0x(i.iv) + strip0x(i.tag) + strip0x(i.cipher)),
  );
  return keccak256('0x' + parts.map((p) => strip0x(p)).join(''));
}

export function nullifiersFiltered(subjectId, scopeRefFilter) {
  const items = itemsOf(subjectId);
  const out = [];
  for (const item of items) {
    const inScope = scopeRefFilter === ZERO_SCOPE || item.scopeRef === scopeRefFilter;
    if (!inScope) continue;
    out.push({
      memoryId: item.memoryId,
      nullifier: keccak256('0x' + strip0x(item.iv) + strip0x(item.tag) + strip0x(item.cipher)),
    });
  }
  return out;
}

export function shredItems(subjectId, scopeRefFilter) {
  const sub = requireActive(subjectId);
  const kept = [];
  const nulled = [];
  for (const item of sub.items) {
    const inScope = scopeRefFilter === ZERO_SCOPE || item.scopeRef === scopeRefFilter;
    if (!inScope) {
      kept.push(item);
      continue;
    }
    nulled.push({
      memoryId: item.memoryId,
      nullifier: keccak256('0x' + strip0x(item.iv) + strip0x(item.tag) + strip0x(item.cipher)),
    });
  }
  sub.items = kept;
  saveDb();
  return nulled;
}

export function requireActive(subjectId) {
  const d = loadDb();
  const sub = d.subjects[subjectId];
  if (!sub) throw new Error('subject not found');
  if (sub.erased) throw new Error('subject already erased');
  return sub;
}

export function recordDec(decHash, dec) {
  const d = loadDb();
  d.decs[decHash] = dec;
  saveDb();
}

export function getDec(decHash) {
  return loadDb().decs[decHash] ?? null;
}

/** Tombstone after a chain-verified erasure: stats remain, ciphertext does not. */
export function markErased(subjectId, { scopeRef, full } = {}) {
  const sub = requireActiveAfterErase(subjectId);
  if (full) {
    sub.erased = true;
    sub.erasedAt = Date.now();
  }
  saveDb();
  return sub;
}

export function requireActiveAfterErase(subjectId) {
  const d = loadDb();
  const sub = d.subjects[subjectId];
  if (!sub) throw new Error('subject not found');
  return sub;
}

export function toBeHexShort(x) {
  return toBeHex(x);
}
