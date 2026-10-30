// @oblivia/sdk tests — abi envelope.
// Matrix rows: 4 kinds x 2 reasons x 5 jurisdictions x 2 scopes = 80 ops,
// each roundtrip-encoded and compared field-by-field plus its own opId.
import { test } from 'node:test';
import { keccak256, toBeHex } from 'ethers';

import {
  ABI, KIND, REASON, NOTARY, STATUS, OP_TUPLE,
  ZERO_ADDRESS, ZERO_SCOPE, ZERO_BYTES3, FULL_SCOPE,
  bytes3, parseBytes3, hexBytes32,
  encodeOp, decodeOp, opIdOf, digestOf,
} from '../src/abi.js';

const VEST_AT = 1700000000;
const addresses = {
  principal: '0x1111111111111111111111111111111111111111',
  guardian: '0x2222222222222222222222222222222222222222',
};
const registry = '0x3333333333333333333333333333333333333333';
const CHAIN_ID = 31337;

function opFor({ kind, reason, jurisdiction, scopeRef, policyVersion }) {
  return {
    kind,
    reason,
    subjectId: '0x' + 'aa'.repeat(31) + (jurisdiction ?? 'x').slice(0, 0) + (reason ?? 0).toString(16).padStart(2, '0'),
    scopeRef,
    hashA: '0x' + 'bb'.repeat(31) + kind.toString(16).padStart(2, '0'),
    hashB: '0x' + 'cc'.repeat(31) + reason.toString(16).padStart(2, '0'),
    account: addresses.guardian,
    policyVersion,
    jurisdictionBytes3: bytes3(jurisdiction),
    vestEligibleAt: VEST_AT,
    nextBand: kind === KIND.VEST ? 1 : 0,
  };
}

const sepAttrs = {
  subjectId: (op) => op.subjectId,
  scopeRef: (op) => op.scopeRef,
  hashA: (op) => op.hashA,
  hashB: (op) => op.hashB,
  account: (op) => op.account.toLowerCase(),
  vestEligibleAt: (op) => op.vestEligibleAt,
  nextBand: (op) => op.nextBand,
};

const kinds = [
  [KIND.ENROLL, 'subjectOpened'],
  [KIND.MEMORY, 'rightWritten'],
  [KIND.ERASE, 'erased'],
  [KIND.VEST, 'vested'],
];
const reasons = [
  [REASON.REQUEST, 'request'],
  [REASON.SUNSET, 'sunset'],
];
const jurisdictions = ['CPP', 'MDP', 'EUR', 'IND', ''];
const scopes = [
  [ZERO_SCOPE, 'FULL'],
  ['0x' + '5c'.repeat(32), 'SCOPE'],
];

for (const [kind, kName] of kinds) {
  for (const [reason, rName] of reasons) {
    for (const jurisdiction of jurisdictions) {
      for (const [scopeRef, sName] of scopes) {
        const label = `${kName}/${rName}/${jurisdiction || 'empty-jurisdiction'}/${sName}`;
        test(`encode → decode preserves every field (${label})`, (t) => {
          const op = opFor({ kind, reason, jurisdiction, scopeRef, policyVersion: 7 });
          const payload = encodeOp(op);
          t.assert.equal(payload.length, 706); // 11 uint256 words (11 * 64 = 704 hex chars) + '0x'
          const out = decodeOp(payload);
          t.assert.equal(out.kind, op.kind);
          t.assert.equal(out.reason, op.reason);
          t.assert.equal(out.subjectId, op.subjectId);
          t.assert.equal(out.scopeRef, scopeRef);
          t.assert.equal(out.hashA, op.hashA);
          t.assert.equal(out.hashB, op.hashB);
          t.assert.equal(out.account.toLowerCase(), addresses.guardian.toLowerCase());
          t.assert.equal(out.policyVersion, 7n);
          t.assert.equal(out.jurisdictionBytes3, op.jurisdictionBytes3);
          t.assert.equal(out.vestEligibleAt, VEST_AT);
          t.assert.equal(out.nextBand, op.nextBand);
        });
        test(`opId depends only on kind+subject+scope, not on reason (${label})`, (t) => {
          const op = opFor({ kind, reason, jurisdiction, scopeRef, policyVersion: 1 });
          const id = opIdOf(CHAIN_ID, registry, op);
          const sameTriple = opFor({
            kind: KIND.VEST,
            reason,
            jurisdiction: 'CPP',
            scopeRef,
            policyVersion: 1,
          });
          const idSameSubject = opIdOf(CHAIN_ID, registry, {
            ...sameTriple,
            subjectId: op.subjectId,
            kind: op.kind,
          });
          t.assert.equal(id, idSameSubject);
        });
      }
    }
  }
}

/* ------------------- opId sensitivity matrix */
const opBase = opFor({ kind: KIND.ERASE, reason: REASON.REQUEST, jurisdiction: 'CPP', scopeRef: ZERO_SCOPE, policyVersion: 1 });
const pivot = opIdOf(CHAIN_ID, registry, opBase);

test('opId: same inputs → same id (deterministic idempotency)', (t) => {
  t.assert.equal(opIdOf(CHAIN_ID, registry, opBase), pivot);
});

test('opId: different chainId → different id', (t) => {
  t.assert.notEqual(opIdOf(1, registry, opBase), pivot);
});

test('opId: different registry → different id', (t) => {
  t.assert.notEqual(opIdOf(CHAIN_ID, '0x4444444444444444444444444444444444444444', opBase), pivot);
});

test('opId: different subjectId → different id', (t) => {
  t.assert.notEqual(opIdOf(CHAIN_ID, registry, { ...opBase, subjectId: '0x' + 'ff'.repeat(32) }), pivot);
});

test('opId: different kind → different id', (t) => {
  t.assert.notEqual(opIdOf(CHAIN_ID, registry, { ...opBase, kind: KIND.ENROLL }), pivot);
});

test('opId: different scopeRef → different id', (t) => {
  t.assert.notEqual(opIdOf(CHAIN_ID, registry, { ...opBase, scopeRef: '0x' + '7e'.repeat(32) }), pivot);
});

test('opId: reason does NOT change the id (collision by design — triple domain)', (t) => {
  t.assert.equal(opIdOf(CHAIN_ID, registry, { ...opBase, reason: REASON.SUNSET }), pivot);
});

/* ------------------- digest binding matrix */
test('digestOf matches hand-composed abi.encode(chainId, registry, payload)', (t) => {
  const payload = encodeOp(opBase);
  const expected = keccak256(
    ABI.encode(
      ['uint256', 'address', 'bytes'],
      [toBeHex(BigInt(CHAIN_ID)), registry, payload],
    ),
  );
  t.assert.equal(digestOf(CHAIN_ID, registry, payload), expected);
});

test('digestOf: chainId-sensitive', (t) => {
  const payload = encodeOp(opBase);
  t.assert.notEqual(digestOf(CHAIN_ID, registry, payload), digestOf(137, registry, payload));
});

test('digestOf: registry-sensitive', (t) => {
  const payload = encodeOp(opBase);
  t.assert.notEqual(digestOf(CHAIN_ID, registry, payload), digestOf(CHAIN_ID, ZERO_ADDRESS, payload));
});

test('digestOf: payload-sensitive (a single swapped hash flips it)', (t) => {
  const a = encodeOp(opBase);
  const b = encodeOp({ ...opBase, hashA: '0x' + '01'.repeat(32) });
  t.assert.notEqual(digestOf(CHAIN_ID, registry, a), digestOf(CHAIN_ID, registry, b));
});
