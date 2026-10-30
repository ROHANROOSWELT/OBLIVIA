// @oblivia/sdk — DEC v2 (Decommissioned Data Certificate) builder + verifier.
// Mirrors hub/src/dec.js exactly. Two hashes:
//   coreHash — hash of the certificate WITHOUT the receipt block. This is what
//              the ERASE op pins on chain (its `hashA`), so no chicken-and-egg
//              with a txHash that doesn't exist yet.
//   fullHash — core + receipt { erasureTxHash, blockNumber, notary, erasedAt }.
//              Issued after the receipt is verified; /verify recomputes it.
import { keccak256, toBeHex } from 'ethers';
import { ZERO_SCOPE } from './abi.js';

export const EXECUTOR_METHOD = 'SALT_SHRED@v1';

export function methodHash() {
  return keccak256(Buffer.from(EXECUTOR_METHOD, 'utf8'));
}

/** Deterministic JSON: sorted keys, no whitespace — the byte-stream that is hashed. */
export function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return JSON.stringify(obj);
  }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

export function decHashOf(dec) {
  return keccak256(Buffer.from(stableStringify(dec), 'utf8'));
}

function core({
  subjectId,
  jurisdiction,
  statuteCite,
  policyVersion,
  scopeRef,
  actor,
  actorAuthority,
  itemNullifiers,
  chainId,
  opId,
}) {
  return {
    type: 'OBLIVIA_DEC_V2',
    version: 2,
    subjectId,
    jurisdiction, // "CPP" | "MDP" | "EUR" | "IND"
    statuteCite,
    policyVersion,
    scope: scopeRef === ZERO_SCOPE ? 'FULL' : scopeRef,
    requestAuthority: {
      actor,
      authority: actorAuthority, // "GUARDIAN" | "VESTED_PRINCIPAL"
      method: 'WALLET_TX',
    },
    executorMethod: EXECUTOR_METHOD,
    methodHash: methodHash(),
    itemNullifiers, // per-item nullifier = keccak256(iv || tag || ciphertext)
    itemsErased: itemNullifiers.length,
    chainId: toBeHex(chainId),
    opId,
  };
}

/** Pre-receipt (chain-pinnable) certificate. payload hashA = its hash. */
export function buildDecCore(inputs) {
  const c = core(inputs);
  return { dec: c, coreHash: decHashOf(c) };
}

/** Full certificate = core + verified receipt. */
export function buildDecFull(inputs, receipt) {
  const c = core(inputs);
  c.receipt = {
    erasureTxHash: receipt.txHash,
    blockNumber: receipt.blockNumber ?? null,
    notary: receipt.notary ?? 'ATTESTOR',
    erasedAt: receipt.erasedAt ?? Date.now(),
  };
  return { dec: c, fullHash: decHashOf(c) };
}

/**
 * Independent verification: recompute the full hash from the certificate
 * body, and (optionally) check the core rehash equals a value the caller
 * separately knows is pinned on chain.
 */
export function verifyDec(dec, expected) {
  const fullHash = decHashOf(dec);
  const ok = expected.fullHash == null ? true : fullHash === expected.fullHash;
  let coreMatches = null;
  if (expected.coreHash != null) {
    const { receipt, ...rest } = dec;
    void receipt;
    coreMatches = decHashOf(rest) === expected.coreHash;
  }
  return { fullHash, ok, coreMatches };
}
