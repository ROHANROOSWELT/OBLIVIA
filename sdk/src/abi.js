// @oblivia/sdk — canonical ABI encoding of the EraseRegistry Op struct.
// Byte-for-byte identical to contracts/src/EraseRegistry.sol's abi.encode(Op)
// and to hub/src/abi.js (kept in lockstep by sdk/tests/parity.spec.mjs).
import {
  AbiCoder,
  keccak256,
  toBeHex,
  verifyMessage,
  zeroPadValue,
} from 'ethers';

export const OP_TUPLE =
  '(uint8 kind,uint8 reason,bytes32 subjectId,bytes32 scopeRef,bytes32 hashA,bytes32 hashB,address account,uint96 policyVersion,bytes3 jurisdiction,uint64 vestEligibleAt,uint8 nextBand)';

export const ABI = AbiCoder.defaultAbiCoder();

export const KIND = Object.freeze({ ENROLL: 0, MEMORY: 1, ERASE: 2, VEST: 3 });
// enum values mirror EraseRegistry.Reason (NONE=0, REQUEST=1, SUNSET=2)
export const REASON = Object.freeze({ NONE: 0, REQUEST: 1, SUNSET: 2 });
export const NOTARY = Object.freeze({ NONE: 0, DON: 1, ATTESTOR: 2 });
export const STATUS = Object.freeze({ NONE: 0, ACTIVE: 1, ERASED: 2 });

export const ZERO_ADDRESS = '0x' + '00'.repeat(20);
export const ZERO_SCOPE = '0x' + '00'.repeat(32); // == FULL_SCOPE on chain
export const ZERO_BYTES3 = '0x000000';

export const FULL_SCOPE = ZERO_SCOPE;

export function hexBytes32(x) {
  if (typeof x === 'string' && x.startsWith('0x')) {
    return zeroPadValue(x, 32);
  }
  return zeroPadValue(toBeHex(BigInt(x ?? 0)), 32);
}

/** "CPP" -> "0x435050"; "" -> "0x000000"; rejects non-ascii or > 3 chars. */
export function bytes3(code) {
  const s = String(code ?? '').toUpperCase();
  if (s.length === 0) return ZERO_BYTES3;
  if (s.length > 3 || !/^[A-Z]{1,3}$/.test(s)) {
    throw new Error(`invalid jurisdiction code: ${JSON.stringify(code)}`);
  }
  return zeroPadValue('0x' + Buffer.from(s, 'ascii').toString('hex'), 3);
}

/** inverse of bytes3(): "0x435050" -> "CPP"; "0x000000" -> "" */
export function parseBytes3(bytes3Hex) {
  const s = String(bytes3Hex ?? '');
  if (s === ZERO_BYTES3) return '';
  return Buffer.from(s.slice(2), 'hex').toString('ascii').replace(/\x00/g, '');
}

/** Encode an `Op` exactly the way Solidity's abi.encode(Op memory) does. */
export function encodeOp(op) {
  const t = [
    Number(op.kind ?? 0),
    Number(op.reason ?? 0),
    hexBytes32(op.subjectId),
    op.scopeRef == null ? ZERO_SCOPE : hexBytes32(op.scopeRef),
    op.hashA == null ? ZERO_SCOPE : hexBytes32(op.hashA),
    op.hashB == null ? ZERO_SCOPE : hexBytes32(op.hashB),
    op.account ?? ZERO_ADDRESS,
    op.policyVersion ?? 0,
    op.jurisdictionBytes3 ?? ZERO_BYTES3,
    op.vestEligibleAt ?? 0,
    op.nextBand ?? 0,
  ];
  return ABI.encode([OP_TUPLE], [t]);
}

/** Decode abi.encode(Op) payload hex back into the typed struct object. */
export function decodeOp(payloadHex) {
  const [t] = ABI.decode([OP_TUPLE], payloadHex);
  return {
    kind: Number(t[0]),
    reason: Number(t[1]),
    subjectId: t[2],
    scopeRef: t[3],
    hashA: t[4],
    hashB: t[5],
    account: t[6],
    policyVersion: t[7],
    jurisdictionBytes3: t[8],
    vestEligibleAt: t[9],
    nextBand: t[10],
  };
}

/** Deterministic op id — hub, workflow, and contract all compute the same. */
export function opIdOf(chainId, registryAddress, op) {
  return keccak256(
    ABI.encode(['uint256', 'address', 'uint8', 'bytes32', 'bytes32'], [
      toBeHex(BigInt(chainId)),
      registryAddress,
      Number(op.kind),
      hexBytes32(op.subjectId),
      op.scopeRef == null ? ZERO_SCOPE : hexBytes32(op.scopeRef),
    ]),
  );
}

/** Digest the contract's notarize() verifies: keccak256(chainId, registry, payload). */
export function digestOf(chainId, registryAddress, payloadHex) {
  return keccak256(
    ABI.encode(['uint256', 'address', 'bytes'], [
      toBeHex(BigInt(chainId)),
      registryAddress,
      payloadHex,
    ]),
  );
}

/**
 * Signature the ATTESTOR path carries: ethers Signer.signMessage(BytesLike)
 * applies EIP-191 ("\x19Ethereum Signed Message:\n32") over our raw digest —
 * exactly the double-wrap the on-chain notarize() verifier expects.
 * `signer` may be any Signer-like with signMessage(); browser + node both work.
 */
export async function signPayload(signer, chainId, registryAddress, payloadHex) {
  const digest = digestOf(chainId, registryAddress, payloadHex);
  return signer.signMessage(digest);
}

/**
 * Verify an ATTESTOR signature WITHOUT the signer — the mirror of EraseRegistry's
 * `ecrecover(EIP191(keccak(chainId, registry, payload))) == s_attestor` check.
 * Accepts EITHER a plain 65-byte r||s||v hex (v in 27/28) OR an ethers-style
 * unified signature string.
 */
export function recoverPayloadSigner(chainId, registryAddress, payloadHex, sig) {
  const digest = digestOf(chainId, registryAddress, payloadHex);
  if (sig == null || sig === '') return ZERO_ADDRESS;
  let normalized = String(sig);
  if (/^0x[0-9a-fA-F]{130}$/.test(normalized)) {
    // Already exactly 65 bytes: r || s || v. Ethers accepts v ∈ {27, 28}.
    // (For 0/1-style v, normalize up by 27 like ecrecover does.)
    const v = parseInt(normalized.slice(130, 132), 16);
    const v27 = v >= 27 ? v : v + 27;
    normalized =
      '0x' + normalized.slice(2, 130) + v27.toString(16).padStart(2, '0');
  }
  return verifyMessage(digest, normalized);
}
