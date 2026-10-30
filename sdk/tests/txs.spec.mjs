// @oblivia/sdk tests — transaction builders & receipt log decoding.
import { test } from 'node:test';
import { Interface, id, ZeroAddress } from 'ethers';
import {
  TxFactory,
  withRegistry,
  decodeErasureCertified,
  registryContract,
} from '../src/txs.js';
import { ZERO_SCOPE, bytes3 } from '../src/abi.js';

const REGISTRY_ADDR = '0x1111111111111111111111111111111111111111';

const REGISTRY_HUMAN = [
  'function openSubject(bytes32 subjectId, bytes3 jurisdiction, bytes32 ageAttestationHash, bytes32 dataRootCommitment, uint64 vestEligibleAt, uint8 nextBand)',
  'function addMemory(bytes32 subjectId, bytes32 scopeRef, bytes32 dataCommitment)',
  'function requestErasure(bytes32 subjectId, bytes32 scopeRef)',
  'function notarize(bytes payload, bytes sig)',
  'event ErasureCertified(bytes32 indexed subjectId, bytes32 indexed scopeRef, bytes32 decHash, bytes32 methodHash, uint8 notary, uint8 reason, uint64 erasedAt)',
];
const IFACE = new Interface(REGISTRY_HUMAN);

test('TxFactory.openSubject builds exact calldata and selector', (t) => {
  const params = {
    subjectId: id('subj-1'),
    jurisdiction: 'CPP',
    ageAttestationHash: id('age-1'),
    dataRootCommitment: id('root-1'),
    vestEligibleAt: 1750000000,
    nextBand: 1,
  };
  const tx = TxFactory.openSubject(params);
  t.assert.equal(typeof tx.data, 'string');
  t.assert.equal(tx.selector, IFACE.getFunction('openSubject').selector);
  t.assert.equal(tx.data.startsWith(tx.selector), true);

  const decoded = IFACE.decodeFunctionData('openSubject', tx.data);
  t.assert.equal(decoded[0], params.subjectId);
  t.assert.equal(decoded[1], bytes3('CPP'));
  t.assert.equal(decoded[2], params.ageAttestationHash);
  t.assert.equal(decoded[3], params.dataRootCommitment);
  t.assert.equal(Number(decoded[4]), params.vestEligibleAt);
  t.assert.equal(Number(decoded[5]), params.nextBand);
});

test('TxFactory.openSubject uses defaults for optional numbers', (t) => {
  const tx = TxFactory.openSubject({
    subjectId: id('subj-default'),
    jurisdiction: 'EUR',
    ageAttestationHash: id('age-def'),
    dataRootCommitment: id('root-def'),
  });
  const decoded = IFACE.decodeFunctionData('openSubject', tx.data);
  t.assert.equal(Number(decoded[4]), 0);
  t.assert.equal(Number(decoded[5]), 0);
});

test('TxFactory.addMemory builds calldata with scopeRef and default ZERO_SCOPE', (t) => {
  const paramsCustom = {
    subjectId: id('subj-mem'),
    scopeRef: id('scope-finance'),
    dataCommitment: id('commit-1'),
  };
  const txCustom = TxFactory.addMemory(paramsCustom);
  t.assert.equal(txCustom.selector, IFACE.getFunction('addMemory').selector);
  const decCustom = IFACE.decodeFunctionData('addMemory', txCustom.data);
  t.assert.equal(decCustom[0], paramsCustom.subjectId);
  t.assert.equal(decCustom[1], paramsCustom.scopeRef);
  t.assert.equal(decCustom[2], paramsCustom.dataCommitment);

  const txDefault = TxFactory.addMemory({
    subjectId: id('subj-mem-2'),
    dataCommitment: id('commit-2'),
  });
  const decDefault = IFACE.decodeFunctionData('addMemory', txDefault.data);
  t.assert.equal(decDefault[1], ZERO_SCOPE);
});

test('TxFactory.requestErasure builds calldata with custom and zero scope', (t) => {
  const txCustom = TxFactory.requestErasure({
    subjectId: id('subj-erase'),
    scopeRef: id('scope-erase'),
  });
  t.assert.equal(txCustom.selector, IFACE.getFunction('requestErasure').selector);
  const decCustom = IFACE.decodeFunctionData('requestErasure', txCustom.data);
  t.assert.equal(decCustom[0], id('subj-erase'));
  t.assert.equal(decCustom[1], id('scope-erase'));

  const txFull = TxFactory.requestErasure({
    subjectId: id('subj-erase-full'),
  });
  const decFull = IFACE.decodeFunctionData('requestErasure', txFull.data);
  t.assert.equal(decFull[1], ZERO_SCOPE);
});

test('TxFactory.notarize builds calldata and validates inputs', (t) => {
  t.assert.throws(() => TxFactory.notarize({}), /notarize requires payload \+ sig/);
  t.assert.throws(() => TxFactory.notarize({ payload: '0x12' }), /notarize requires payload \+ sig/);
  t.assert.throws(() => TxFactory.notarize({ sig: '0x34' }), /notarize requires payload \+ sig/);

  const tx = TxFactory.notarize({ payload: '0xaabbcc', sig: '0x112233' });
  t.assert.equal(tx.selector, IFACE.getFunction('notarize').selector);
  const decoded = IFACE.decodeFunctionData('notarize', tx.data);
  t.assert.equal(decoded[0], '0xaabbcc');
  t.assert.equal(decoded[1], '0x112233');
});

test('withRegistry attaches the to address', (t) => {
  const rawTx = TxFactory.requestErasure({ subjectId: id('s'), scopeRef: ZERO_SCOPE });
  const attached = withRegistry(REGISTRY_ADDR, rawTx);
  t.assert.equal(attached.to, REGISTRY_ADDR);
  t.assert.equal(attached.data, rawTx.data);
  t.assert.equal(attached.selector, rawTx.selector);
});

test('decodeErasureCertified handles null, empty, and non-matching logs', (t) => {
  t.assert.equal(decodeErasureCertified(null), null);
  t.assert.equal(decodeErasureCertified({}), null);
  t.assert.equal(decodeErasureCertified({ logs: [] }), null);

  const unrelatedLog = {
    topics: [id('SomeOtherEvent(bytes32)')],
    data: '0x',
  };
  t.assert.equal(decodeErasureCertified([unrelatedLog]), null);
  t.assert.equal(decodeErasureCertified({ logs: [unrelatedLog] }), null);
});

// Matrix of log decoding across Notaries and Reasons
const notaryCases = [
  { val: 1, expected: 'DON' },
  { val: 2, expected: 'ATTESTOR' },
  { val: 0, expected: 'NONE' },
];
const reasonCases = [
  { val: 1, expected: 'REQUEST' },
  { val: 2, expected: 'SUNSET' },
];
const scopeOptions = [
  { ref: ZERO_SCOPE, name: 'FULL' },
  { ref: id('scope-chat-history'), name: 'CUSTOM' },
];

for (const notary of notaryCases) {
  for (const reason of reasonCases) {
    for (const scope of scopeOptions) {
      test(`decodeErasureCertified: ${notary.expected}/${reason.expected}/${scope.name}`, (t) => {
        const subjectId = id('subject-matrix');
        const decHash = id('dec-matrix');
        const methodHash = id('method-matrix');
        const erasedAt = 1730000500;

        // Encode ErasureCertified event log
        const log = IFACE.encodeEventLog(
          IFACE.getEvent('ErasureCertified'),
          [subjectId, scope.ref, decHash, methodHash, notary.val, reason.val, erasedAt],
        );

        // Put log in array, optionally preceded and followed by unrelated logs
        const noisyLogs = [
          { topics: [id('NoiseA()')], data: '0x' },
          log,
          { topics: [id('NoiseB()')], data: '0x' },
        ];

        const parsed = decodeErasureCertified(noisyLogs);
        t.assert.notEqual(parsed, null);
        t.assert.equal(parsed.subjectId, subjectId);
        t.assert.equal(parsed.scopeRef, scope.ref);
        t.assert.equal(parsed.decHash, decHash);
        t.assert.equal(parsed.methodHash, methodHash);
        t.assert.equal(parsed.notaryPath, notary.expected);
        t.assert.equal(parsed.reason, reason.expected);
        t.assert.equal(parsed.erasedAt, erasedAt);
      });
    }
  }
}

test('registryContract returns instantiated ethers Contract', (t) => {
  const contract = registryContract(REGISTRY_ADDR, null);
  t.assert.equal(contract.target, REGISTRY_ADDR);
  t.assert.equal(typeof contract.openSubject, 'function');
  t.assert.equal(typeof contract.addMemory, 'function');
  t.assert.equal(typeof contract.requestErasure, 'function');
  t.assert.equal(typeof contract.notarize, 'function');
});

// Parameter Matrix for TxFactory
const jCodes = ['CPP', 'MDP', 'EUR', 'IND'];
const bands = [0, 1, 2];
const vestTimes = [0, 1750000000, 1850000000];

for (const jurisdiction of jCodes) {
  for (const nextBand of bands) {
    for (const vestEligibleAt of vestTimes) {
      test(`TxFactory.openSubject round-trip (${jurisdiction}/band:${nextBand}/vest:${vestEligibleAt})`, (t) => {
        const subjectId = id(`subject-${jurisdiction}-${nextBand}-${vestEligibleAt}`);
        const ageHash = id(`age-${jurisdiction}`);
        const dataRoot = id(`root-${jurisdiction}`);
        const tx = TxFactory.openSubject({
          subjectId,
          jurisdiction,
          ageAttestationHash: ageHash,
          dataRootCommitment: dataRoot,
          vestEligibleAt,
          nextBand,
        });
        const decoded = IFACE.decodeFunctionData('openSubject', tx.data);
        t.assert.equal(decoded[0], subjectId);
        t.assert.equal(decoded[1], bytes3(jurisdiction));
        t.assert.equal(decoded[2], ageHash);
        t.assert.equal(decoded[3], dataRoot);
        t.assert.equal(Number(decoded[4]), vestEligibleAt);
        t.assert.equal(Number(decoded[5]), nextBand);
      });
    }
  }
}

for (let i = 0; i < 10; i++) {
  test(`TxFactory.addMemory round-trip index ${i}`, (t) => {
    const subjectId = id(`subject-mem-${i}`);
    const scopeRef = id(`scope-${i}`);
    const dataCommitment = id(`commit-${i}`);
    const tx = TxFactory.addMemory({ subjectId, scopeRef, dataCommitment });
    const decoded = IFACE.decodeFunctionData('addMemory', tx.data);
    t.assert.equal(decoded[0], subjectId);
    t.assert.equal(decoded[1], scopeRef);
    t.assert.equal(decoded[2], dataCommitment);
  });
}

for (let i = 0; i < 10; i++) {
  test(`TxFactory.requestErasure round-trip index ${i}`, (t) => {
    const subjectId = id(`subject-req-${i}`);
    const scopeRef = id(`scope-req-${i}`);
    const tx = TxFactory.requestErasure({ subjectId, scopeRef });
    const decoded = IFACE.decodeFunctionData('requestErasure', tx.data);
    t.assert.equal(decoded[0], subjectId);
    t.assert.equal(decoded[1], scopeRef);
  });
}

