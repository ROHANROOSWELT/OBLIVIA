// @oblivia/sdk — vault-crypto commitments. Pure functions over the item
// tuples ({memoryId, iv, tag, cipher}) that the guardian's browser produces;
// the hub stores exactly these tuples, so an integrator can recompute the
// same dataRoot commitment the guardian pinned on chain, and single-item
// nullifiers, WITHOUT access to any plaintext.
import { keccak256 } from 'ethers';
import { ZERO_SCOPE } from './abi.js';

export function strip0x(hex) {
  return String(hex ?? '').replace(/^0x/i, '');
}

export function itemHash(item) {
  return keccak256('0x' + strip0x(item.iv) + strip0x(item.tag) + strip0x(item.cipher));
}

/** nullifier = keccak256(iv || tag || cipher) for ONE item. */
export function nullifierFor(item) {
  return itemHash(item);
}

/**
 * Deterministic commitment over the current memory tree.
 * dataRoot = keccak256( concat( itemHash(item) for each item sorted by memoryId ) ).
 * Same algorithm the hub's vault.js uses — clients can predict the root they
 * will pin BEFORE hitting the hub.
 */
export function dataRootOf(items) {
  const sorted = [...(items ?? [])].sort((a, b) =>
    a.memoryId < b.memoryId ? -1 : a.memoryId > b.memoryId ? 1 : 0,
  );
  const parts = sorted.map((i) => itemHash(i));
  return keccak256('0x' + parts.map((p) => strip0x(p)).join(''));
}

/** All nullifiers that fall in scope (scopeRefFilter zero == FULL scope). */
export function nullifiersFiltered(items, scopeRefFilter) {
  const out = [];
  for (const item of items ?? []) {
    const inScope = scopeRefFilter === ZERO_SCOPE || item.scopeRef === scopeRefFilter;
    if (!inScope) continue;
    out.push({
      memoryId: item.memoryId,
      nullifier: itemHash(item),
    });
  }
  return out;
}
