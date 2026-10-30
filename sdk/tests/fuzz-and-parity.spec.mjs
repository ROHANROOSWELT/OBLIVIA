// @oblivia/sdk tests — property-based fuzzing and hub parity verification.
import { test } from 'node:test';
import { id, keccak256, toBeHex } from 'ethers';
import {
  encodeOp,
  decodeOp,
  opIdOf,
  digestOf,
  bytes3,
  parseBytes3,
  hexBytes32,
  KIND,
  REASON,
  ZERO_SCOPE,
} from '../src/abi.js';
import { stableStringify, decHashOf, methodHash } from '../src/dec.js';
import { itemHash, dataRootOf } from '../src/vault-crypto.js';

import * as hubAbi from '../../hub/src/abi.js';
import * as hubDec from '../../hub/src/dec.js';

// --- Part 1: Hub Parity ---
test('hub parity: OP_TUPLE matches hub exactly', (t) => {
  t.assert.equal(hubAbi.OP_TUPLE, '(uint8 kind,uint8 reason,bytes32 subjectId,bytes32 scopeRef,bytes32 hashA,bytes32 hashB,address account,uint96 policyVersion,bytes3 jurisdiction,uint64 vestEligibleAt,uint8 nextBand)');
});

test('hub parity: methodHash matches hub methodHash', (t) => {
  t.assert.equal(methodHash(), hubDec.methodHash());
});

test('hub parity: stableStringify matches hub stableStringify', (t) => {
  const sample = { z: [1, 2], b: { c: 'hello', a: 10 }, a: 'alpha' };
  t.assert.equal(stableStringify(sample), hubDec.stableStringify(sample));
});

test('hub parity: decHashOf matches hub decHashOf', (t) => {
  const dec = { type: 'OBLIVIA_DEC_V2', version: 2, count: 5 };
  t.assert.equal(decHashOf(dec), hubDec.decHashOf(dec));
});

// Matrix of parity tests for encodeOp / opIdOf / digestOf
const parityOps = [
  { kind: KIND.ENROLL, reason: REASON.NONE, jurisdiction: 'CPP', scopeRef: ZERO_SCOPE },
  { kind: KIND.MEMORY, reason: REASON.REQUEST, jurisdiction: 'MDP', scopeRef: id('mem-scope') },
  { kind: KIND.ERASE, reason: REASON.SUNSET, jurisdiction: 'EUR', scopeRef: ZERO_SCOPE },
  { kind: KIND.VEST, reason: REASON.REQUEST, jurisdiction: 'IND', scopeRef: ZERO_SCOPE },
];

for (let i = 0; i < parityOps.length; i++) {
  const p = parityOps[i];
  test(`hub parity: encodeOp, opIdOf, digestOf (case ${i})`, (t) => {
    const op = {
      kind: p.kind,
      reason: p.reason,
      subjectId: id(`sub-${i}`),
      scopeRef: p.scopeRef,
      hashA: id(`hashA-${i}`),
      hashB: id(`hashB-${i}`),
      account: '0x1111111111111111111111111111111111111111',
      policyVersion: 2,
      jurisdictionBytes3: bytes3(p.jurisdiction),
      vestEligibleAt: 1750000000,
      nextBand: 1,
    };
    const sdkEncoded = encodeOp(op);
    const hubEncoded = hubAbi.encodeOp(op);
    t.assert.equal(sdkEncoded, hubEncoded);

    const registry = '0x3333333333333333333333333333333333333333';
    const chainId = 31337;
    t.assert.equal(opIdOf(chainId, registry, op), hubAbi.opIdOf(chainId, registry, op));
    t.assert.equal(digestOf(chainId, registry, sdkEncoded), hubAbi.digestOf(chainId, registry, hubEncoded));
  });
}

// --- Part 2: Fuzzing Op Round-Trips (50 random variations) ---
function pseudoRandomHex(len, seed) {
  let h = '';
  for (let i = 0; i < len; i++) {
    h += ((seed * (i + 1) * 31 + 17) % 16).toString(16);
  }
  return '0x' + h;
}

for (let i = 0; i < 50; i++) {
  test(`property fuzz: encodeOp <-> decodeOp lossless round-trip (run ${i})`, (t) => {
    const kind = i % 4;
    const reason = (i * 3) % 3;
    const subjectId = pseudoRandomHex(64, i + 1);
    const scopeRef = i % 2 === 0 ? ZERO_SCOPE : pseudoRandomHex(64, i + 11);
    const hashA = pseudoRandomHex(64, i + 21);
    const hashB = pseudoRandomHex(64, i + 31);
    const account = pseudoRandomHex(40, i + 41);
    const policyVersion = (i * 7) % 50;
    const jCodes = ['CPP', 'MDP', 'EUR', 'IND', ''];
    const jurisdiction = jCodes[i % jCodes.length];
    const vestEligibleAt = 1700000000 + i * 86400;
    const nextBand = i % 5;

    const op = {
      kind,
      reason,
      subjectId,
      scopeRef,
      hashA,
      hashB,
      account,
      policyVersion,
      jurisdictionBytes3: bytes3(jurisdiction),
      vestEligibleAt,
      nextBand,
    };

    const encoded = encodeOp(op);
    t.assert.equal(encoded.length, 706);

    const decoded = decodeOp(encoded);
    t.assert.equal(decoded.kind, kind);
    t.assert.equal(decoded.reason, reason);
    t.assert.equal(decoded.subjectId.toLowerCase(), subjectId.toLowerCase());
    t.assert.equal(decoded.scopeRef.toLowerCase(), scopeRef.toLowerCase());
    t.assert.equal(decoded.hashA.toLowerCase(), hashA.toLowerCase());
    t.assert.equal(decoded.hashB.toLowerCase(), hashB.toLowerCase());
    t.assert.equal(decoded.account.toLowerCase(), account.toLowerCase());
    t.assert.equal(Number(decoded.policyVersion), policyVersion);
    t.assert.equal(decoded.jurisdictionBytes3, bytes3(jurisdiction));
    t.assert.equal(Number(decoded.vestEligibleAt), vestEligibleAt);
    t.assert.equal(Number(decoded.nextBand), nextBand);
  });
}

// --- Part 3: Fuzzing DEC v2 Key Order Invariance (30 tests) ---
for (let i = 0; i < 30; i++) {
  test(`property fuzz: stableStringify key ordering invariance (permutation ${i})`, (t) => {
    const keys = ['fieldA', 'fieldB', 'fieldC', 'fieldD', 'fieldE'];
    // Rotate keys based on iteration
    const rotated = [...keys.slice(i % keys.length), ...keys.slice(0, i % keys.length)];
    const objA = {};
    const objB = {};

    keys.forEach((k, idx) => {
      objA[k] = idx * 10;
    });
    rotated.forEach((k, idx) => {
      objB[k] = keys.indexOf(k) * 10;
    });

    t.assert.equal(stableStringify(objA), stableStringify(objB));
    t.assert.equal(decHashOf(objA), decHashOf(objB));
  });
}

// --- Part 4: Fuzzing dataRootOf Permutation Invariance (30 tests) ---
for (let i = 0; i < 30; i++) {
  test(`property fuzz: dataRootOf ordering invariance across ${3 + (i % 5)} items (seed ${i})`, (t) => {
    const count = 3 + (i % 5);
    const items = [];
    for (let j = 0; j < count; j++) {
      items.push({
        memoryId: `mem-${(j * 7 + i) % 20}`,
        iv: pseudoRandomHex(24, j + 1),
        tag: pseudoRandomHex(32, j + 2),
        cipher: pseudoRandomHex(64, j + 3),
      });
    }

    // Shuffled version
    const shuffled = [...items].reverse();

    const root1 = dataRootOf(items);
    const root2 = dataRootOf(shuffled);
    t.assert.equal(root1, root2);
    t.assert.equal(root1.startsWith('0x'), true);
    t.assert.equal(root1.length, 66);
  });
}
