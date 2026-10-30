// @oblivia/sdk tests — DEC v2 evidence engine.
import { test } from 'node:test';
import { id, keccak256 } from 'ethers';
import {
  EXECUTOR_METHOD,
  methodHash,
  stableStringify,
  decHashOf,
  buildDecCore,
  buildDecFull,
  verifyDec,
} from '../src/dec.js';
import { ZERO_SCOPE } from '../src/abi.js';

test('methodHash matches keccak256(EXECUTOR_METHOD)', (t) => {
  const expected = keccak256(Buffer.from(EXECUTOR_METHOD, 'utf8'));
  t.assert.equal(methodHash(), expected);
  t.assert.equal(EXECUTOR_METHOD, 'SALT_SHRED@v1');
});

test('stableStringify: object key ordering invariance', (t) => {
  const obj1 = { z: 1, a: 2, m: { y: 'nested', b: 42 } };
  const obj2 = { a: 2, m: { b: 42, y: 'nested' }, z: 1 };
  const obj3 = { m: { y: 'nested', b: 42 }, z: 1, a: 2 };

  const s1 = stableStringify(obj1);
  const s2 = stableStringify(obj2);
  const s3 = stableStringify(obj3);

  t.assert.equal(s1, s2);
  t.assert.equal(s2, s3);
  t.assert.equal(s1, '{"a":2,"m":{"b":42,"y":"nested"},"z":1}');
});

test('stableStringify: preserves primitives, null, and arrays in order', (t) => {
  t.assert.equal(stableStringify(null), 'null');
  t.assert.equal(stableStringify(123), '123');
  t.assert.equal(stableStringify('hello'), '"hello"');
  t.assert.equal(stableStringify([3, 1, 2]), '[3,1,2]');
  t.assert.equal(stableStringify({ arr: [2, 1], flag: true }), '{"arr":[2,1],"flag":true}');
});

test('decHashOf matches keccak256 of stableStringify', (t) => {
  const sample = { b: 'val', a: 1 };
  const expected = keccak256(Buffer.from('{"a":1,"b":"val"}', 'utf8'));
  t.assert.equal(decHashOf(sample), expected);
});

// DEC Core & Full Verification Matrix
const jurisdictions = ['CPP', 'MDP', 'EUR', 'IND'];
const authorities = ['GUARDIAN', 'VESTED_PRINCIPAL'];
const scopes = [
  { ref: ZERO_SCOPE, name: 'FULL' },
  { ref: id('custom-scope-finance'), name: 'CUSTOM' },
];
const nullifierCounts = [0, 1, 3, 10];

for (const jurisdiction of jurisdictions) {
  for (const authority of authorities) {
    for (const scope of scopes) {
      for (const count of nullifierCounts) {
        const label = `${jurisdiction}/${authority}/${scope.name}/nullifiers:${count}`;
        test(`DEC v2 lifecycle & verification (${label})`, (t) => {
          const nullifiers = Array.from({ length: count }, (_, i) => id(`item-${i}`));
          const inputs = {
            subjectId: id('subject-alpha'),
            jurisdiction,
            statuteCite: `${jurisdiction} Statute Title 1`,
            policyVersion: 2,
            scopeRef: scope.ref,
            actor: '0x1111111111111111111111111111111111111111',
            actorAuthority: authority,
            itemNullifiers: nullifiers,
            chainId: 31337,
            opId: id('op-123'),
          };

          const coreResult = buildDecCore(inputs);
          t.assert.equal(coreResult.dec.type, 'OBLIVIA_DEC_V2');
          t.assert.equal(coreResult.dec.version, 2);
          t.assert.equal(coreResult.dec.itemsErased, count);
          t.assert.equal(coreResult.dec.scope, scope.ref === ZERO_SCOPE ? 'FULL' : scope.ref);
          t.assert.equal(coreResult.coreHash, decHashOf(coreResult.dec));

          const receipt = {
            txHash: id('tx-erasure-confirmed'),
            blockNumber: 424242,
            notary: 'ATTESTOR',
            erasedAt: 1730000000,
          };

          const fullResult = buildDecFull(inputs, receipt);
          t.assert.notEqual(fullResult.fullHash, coreResult.coreHash);
          t.assert.equal(fullResult.dec.receipt.erasureTxHash, receipt.txHash);
          t.assert.equal(fullResult.dec.receipt.blockNumber, receipt.blockNumber);

          // Full verification succeeds
          const vOk = verifyDec(fullResult.dec, {
            coreHash: coreResult.coreHash,
            fullHash: fullResult.fullHash,
          });
          t.assert.equal(vOk.ok, true);
          t.assert.equal(vOk.coreMatches, true);

          // Verification fails on tampered coreHash
          const vTamperedCore = verifyDec(fullResult.dec, {
            coreHash: id('wrong-core'),
            fullHash: fullResult.fullHash,
          });
          t.assert.equal(vTamperedCore.coreMatches, false);

          // Verification fails on tampered fullHash
          const vTamperedFull = verifyDec(fullResult.dec, {
            coreHash: coreResult.coreHash,
            fullHash: id('wrong-full'),
          });
          t.assert.equal(vTamperedFull.ok, false);
        });
      }
    }
  }
}

test('verifyDec detects tampered receipt in body', (t) => {
  const inputs = {
    subjectId: id('subject-tamper'),
    jurisdiction: 'EUR',
    statuteCite: 'GDPR Art 17',
    policyVersion: 1,
    scopeRef: ZERO_SCOPE,
    actor: '0x1111111111111111111111111111111111111111',
    actorAuthority: 'GUARDIAN',
    itemNullifiers: [id('n1')],
    chainId: 31337,
    opId: id('op-tamper'),
  };
  const receipt = { txHash: id('tx-1'), blockNumber: 100, notary: 'DON', erasedAt: 1730000000 };
  const full = buildDecFull(inputs, receipt);
  const correctFullHash = full.fullHash;

  const tamperedDec = JSON.parse(JSON.stringify(full.dec));
  tamperedDec.receipt.blockNumber = 999999; // tampered block

  const check = verifyDec(tamperedDec, { fullHash: correctFullHash });
  t.assert.equal(check.ok, false);
});

test('verifyDec allows omitting fullHash or coreHash checks', (t) => {
  const inputs = {
    subjectId: id('subject-partial'),
    jurisdiction: 'IND',
    statuteCite: 'DPDP',
    policyVersion: 1,
    scopeRef: ZERO_SCOPE,
    actor: '0x1111111111111111111111111111111111111111',
    actorAuthority: 'GUARDIAN',
    itemNullifiers: [],
    chainId: 31337,
    opId: id('op-partial'),
  };
  const full = buildDecFull(inputs, { txHash: id('tx-2') });

  const onlyFull = verifyDec(full.dec, { fullHash: full.fullHash });
  t.assert.equal(onlyFull.ok, true);
  t.assert.equal(onlyFull.coreMatches, null);

  const core = buildDecCore(inputs);
  const onlyCore = verifyDec(full.dec, { coreHash: core.coreHash });
  t.assert.equal(onlyCore.ok, true);
  t.assert.equal(onlyCore.coreMatches, true);
});
