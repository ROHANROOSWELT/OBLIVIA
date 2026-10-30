// Oblivia hub — canonical ABI encoders for the EraseRegistry Op struct.
// Byte-for-byte identical to contracts/src/EraseRegistry.sol's abi.encode(Op).
import { AbiCoder, keccak256, toBeHex, zeroPadValue } from 'ethers';

export const OP_TUPLE =
  '(uint8 kind,uint8 reason,bytes32 subjectId,bytes32 scopeRef,bytes32 hashA,bytes32 hashB,address account,uint96 policyVersion,bytes3 jurisdiction,uint64 vestEligibleAt,uint8 nextBand)';

export const ABI = AbiCoder.defaultAbiCoder();

export const KIND = { ENROLL: 0, MEMORY: 1, ERASE: 2, VEST: 3 };
// enum values mirror EraseRegistry.Reason (NONE=0, REQUEST=1, SUNSET=2)
export const REASON = { NONE: 0, REQUEST: 1, SUNSET: 2 };

export const NOTARY = { NONE: 0, DON: 1, ATTESTOR: 2 };

export const ZERO_ADDRESS = '0x' + '00'.repeat(20);
export const ZERO_SCOPE = '0x' + '00'.repeat(32);
export const ZERO_BYTES3 = '0x000000';

export function hexBytes32(x) {
  return zeroPadValue(
    typeof x === 'string' && x.startsWith('0x') ? x : toBeHex(BigInt(x ?? 0)),
    32,
  );
}

export function bytes3(code) {
  const s = String(code).toUpperCase();
  if (s.length > 3) throw new Error('jurisdiction code must be at most 3 chars');
  return zeroPadValue('0x' + Buffer.from(s, 'ascii').toString('hex'), 3);
}

/** Encode an `Op` the way solidity abi.encode(Op memory) does. */
export function encodeOp(op) {
  const t = [
    op.kind,
    op.reason ?? 0,
    op.subjectId,
    op.scopeRef ?? ZERO_SCOPE,
    op.hashA ?? ZERO_SCOPE,
    op.hashB ?? ZERO_SCOPE,
    op.account ?? ZERO_ADDRESS,
    op.policyVersion ?? 0,
    op.jurisdictionBytes3 ?? ZERO_BYTES3,
    op.vestEligibleAt ?? 0,
    op.nextBand ?? 0,
  ];
  return ABI.encode([OP_TUPLE], [t]);
}

/** Decode an abi.encode(Op) payload hex back into the typed struct object. */
export function decodeOp(payloadHex) {
  const [t] = ABI.decode([OP_TUPLE], payloadHex);
  return {
    kind: t[0],
    reason: t[1],
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

export function opIdOf(chainId, registryAddress, op) {
  return keccak256(
    ABI.encode(['uint256', 'address', 'uint8', 'bytes32', 'bytes32'], [
      toBeHex(chainId),
      registryAddress,
      op.kind,
      op.subjectId,
      op.scopeRef ?? ZERO_SCOPE,
    ]),
  );
}

export function digestOf(chainId, registryAddress, payloadHex) {
  return keccak256(
    ABI.encode(['uint256', 'address', 'bytes'], [toBeHex(chainId), registryAddress, payloadHex]),
  );
}
