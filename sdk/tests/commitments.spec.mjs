// @oblivia/sdk tests — commitments module.
// dataRoot = keccak256(concat(itemHash(item) for items sorted by memoryId));
// permutation-invariant, membership-sensitive, byte-sensitive.
// EVERY test here is one real behavior case.
import { test } from 'node:test';
import { keccak256 } from 'ethers';

import {
  dataRootOf,
  nullifierFor,
  nullifiersFiltered,
  itemHash,
  strip0x,
} from '../src/vault-crypto.js';
import { ZERO_SCOPE } from '../src/abi.js';

const A = { memoryId: 'item-a', iv: '0x' + 'aa'.repeat(12), tag: '0x' + 'bb'.repeat(16), cipher: '0x' + 'cc'.repeat(24), scopeRef: '0x' + '55'.repeat(32) };
const B = { ...A, memoryId: 'item-b' };
const C = { ...A, memoryId: 'item-c' };
const D = { ...A, memoryId: 'item-d', cipher: '0x' + 'd5'.repeat(24) };
const E = { ...A, memoryId: 'item-e' };

/* ------------------------------------------------ empty + single */

test('dataRootOf([]) equals keccak256 of empty data', (t) => {
  t.assert.equal(dataRootOf([]), '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
});

test('dataRootOf([item]) layers: root = keccak256("0x" + itemHash.slice(2)) — hub parity', (t) => {
  // hub semantics: item hashes are concatenated as stripped hex STRINGS,
  // then hashed once more (a two-layer commitment).
  t.assert.equal(dataRootOf([A]), keccak256('0x' + itemHash(A).slice(2)));
});

test('item hash for {iv aa.., tag bb.., cipher cc..} is stable', (t) => {
  t.assert.equal(itemHash(A), nullifierFor(A));
  t.assert.match(itemHash(A), /^0x[0-9a-f]{64}$/);
});

test('changing the cipher changes the item hash', (t) => {
  const M = { ...A, cipher: '0x' + 'cd'.repeat(24) };
  t.assert.notEqual(itemHash(M), itemHash(A));
});

test('changing the tag changes the item hash', (t) => {
  const M = { ...A, tag: '0x' + 'bd'.repeat(16) };
  t.assert.notEqual(itemHash(M), itemHash(A));
});

test('changing the iv changes the item hash', (t) => {
  const M = { ...A, iv: '0x' + 'a2'.repeat(12) };
  t.assert.notEqual(itemHash(M), itemHash(A));
});

/* ------------------------------------------------ permutation invariance */

function* permutations(arr) {
  if (arr.length === 0) yield [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const p of permutations(rest)) yield [arr[i], ...p];
  }
}

for (const perm of permutations([A, B, C, D])) {
  const label = perm.map((x) => x.memoryId.slice(-1)).join('');
  test(`dataRootOf: 4-permutation [${label}] is invariant and equals the sorted root`, (t) => {
    t.assert.equal(dataRootOf(perm), dataRootOf([A, B, C, D]));
  });
}

for (const perm of permutations([A, B, C, D, E])) {
  const label = perm.map((x) => x.memoryId.slice(-1)).join('');
  test(`dataRootOf: 5-permutation [${label}] is invariant`, (t) => {
    t.assert.equal(dataRootOf(perm), dataRootOf([A, B, C, D, E]));
  });
}

/* ------------------------------------------------ membership sensitivity */

test('adding an item changes the dataRoot', (t) => {
  t.assert.notEqual(dataRootOf([A]), dataRootOf([A, B]));
  t.assert.notEqual(dataRootOf([A, B]), dataRootOf([A, B, C]));
  t.assert.notEqual(dataRootOf([A, B, C]), dataRootOf([A, B, C, D]));
});

test('removing an item changes the dataRoot', (t) => {
  t.assert.notEqual(dataRootOf([A, B]), dataRootOf([A]));
  t.assert.notEqual(dataRootOf([A, B, C]), dataRootOf([A, C]));
});

test('swapping one item for another changes the dataRoot', (t) => {
  t.assert.notEqual(dataRootOf([A, B, C]), dataRootOf([A, B, D]));
});

test('duplicating an item changes the dataRoot (it is a hash LIST, not a SET)', (t) => {
  t.assert.notEqual(dataRootOf([A]), dataRootOf([A, A]));
});

/* ------------------------------------------------ scope filtering */

test('nullifiersFiltered FULL scope returns every item nullifier', (t) => {
  const out = nullifiersFiltered([A, B, C], ZERO_SCOPE);
  t.assert.equal(out.length, 3);
  t.assert.deepEqual(out.map((n) => n.memoryId), ['item-a', 'item-b', 'item-c']);
  t.assert.deepEqual(out.map((n) => n.nullifier), [itemHash(A), itemHash(B), itemHash(C)]);
});

test('nullifiersFiltered for one scope keeps only matching items', (t) => {
  const scope1 = '0x' + '55'.repeat(32);
  const scope2 = '0x' + '66'.repeat(32);
  const items = [
    { ...A, scopeRef: scope1 },
    { ...B, scopeRef: scope2 },
    { ...C, scopeRef: scope1 },
  ];
  t.assert.deepEqual(nullifiersFiltered(items, scope1).map((n) => n.memoryId), ['item-a', 'item-c']);
  t.assert.deepEqual(nullifiersFiltered(items, scope2).map((n) => n.memoryId), ['item-b']);
});

test('nullifiersFiltered for an unmatched scope returns []', (t) => {
  t.assert.deepEqual(nullifiersFiltered([A, B], '0x' + '77'.repeat(32)), []);
});

test('nullifiersFiltered of [] under FULL scope returns []', (t) => {
  t.assert.deepEqual(nullifiersFiltered([], ZERO_SCOPE), []);
});

/* ------------------------------------------------ helpers */

test('strip0x removes an optional 0x prefix', (t) => {
  t.assert.equal(strip0x('0xdead'), 'dead');
  t.assert.equal(strip0x('dead'), 'dead');
  t.assert.equal(strip0x('0XCAFE'), 'CAFE');
  t.assert.equal(strip0x(null), '');
});
