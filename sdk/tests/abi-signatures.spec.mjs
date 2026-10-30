// @oblivia/sdk tests — signature generation, recovery, and bytes3 encoding.
import { test } from 'node:test';
import { Wallet, id, keccak256 } from 'ethers';
import {
  bytes3,
  parseBytes3,
  signPayload,
  recoverPayloadSigner,
  digestOf,
  encodeOp,
  ZERO_ADDRESS,
  ZERO_BYTES3,
  KIND,
  REASON,
} from '../src/abi.js';

const TEST_PRIVATE_KEY_1 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Anvil default #0
const TEST_PRIVATE_KEY_2 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // Anvil default #1
const wallet1 = new Wallet(TEST_PRIVATE_KEY_1);
const wallet2 = new Wallet(TEST_PRIVATE_KEY_2);

const CHAIN_ID = 31337;
const REGISTRY = '0x3333333333333333333333333333333333333333';

const dummyOp = {
  kind: KIND.ERASE,
  reason: REASON.REQUEST,
  subjectId: id('sub-1'),
  scopeRef: id('scope-1'),
  hashA: id('dec-hash'),
  hashB: id('method-hash'),
  account: wallet1.address,
  policyVersion: 1,
  jurisdictionBytes3: bytes3('CPP'),
  vestEligibleAt: 1800000000,
  nextBand: 0,
};
const dummyPayload = encodeOp(dummyOp);

test('bytes3 encodes standard 3-letter codes', (t) => {
  t.assert.equal(bytes3('CPP'), '0x435050');
  t.assert.equal(bytes3('MDP'), '0x4d4450');
  t.assert.equal(bytes3('EUR'), '0x455552');
  t.assert.equal(bytes3('IND'), '0x494e44');
});

test('bytes3 encodes short codes with zero padding to 3 bytes', (t) => {
  t.assert.equal(bytes3('US'), '0x005553');
  t.assert.equal(bytes3('A'), '0x000041');
  t.assert.equal(bytes3(''), ZERO_BYTES3);
  t.assert.equal(bytes3(null), ZERO_BYTES3);
  t.assert.equal(bytes3(undefined), ZERO_BYTES3);
});

test('bytes3 uppercases lowercase letters', (t) => {
  t.assert.equal(bytes3('cpp'), '0x435050');
  t.assert.equal(bytes3('mdp'), '0x4d4450');
  t.assert.equal(bytes3('eur'), '0x455552');
  t.assert.equal(bytes3('ind'), '0x494e44');
});

test('bytes3 rejects invalid codes (> 3 chars or non-alphabetic)', (t) => {
  t.assert.throws(() => bytes3('ABCD'), /invalid jurisdiction code/);
  t.assert.throws(() => bytes3('US1'), /invalid jurisdiction code/);
  t.assert.throws(() => bytes3('C-P'), /invalid jurisdiction code/);
  t.assert.throws(() => bytes3('  '), /invalid jurisdiction code/);
});

test('parseBytes3 decodes back to original ASCII string', (t) => {
  t.assert.equal(parseBytes3('0x435050'), 'CPP');
  t.assert.equal(parseBytes3('0x4d4450'), 'MDP');
  t.assert.equal(parseBytes3('0x455552'), 'EUR');
  t.assert.equal(parseBytes3('0x494e44'), 'IND');
  t.assert.equal(parseBytes3(ZERO_BYTES3), '');
  t.assert.equal(parseBytes3(null), '');
});

// Matrix of 26 single-letter codes
for (let i = 0; i < 26; i++) {
  const char = String.fromCharCode(65 + i);
  test(`bytes3 round-trip for single-letter code '${char}'`, (t) => {
    const encoded = bytes3(char);
    t.assert.equal(encoded.length, 8); // '0x' + 6 hex chars
    t.assert.equal(parseBytes3(encoded), char);
  });
}

test('signPayload produces valid signature that recoverPayloadSigner verifies', async (t) => {
  const sig = await signPayload(wallet1, CHAIN_ID, REGISTRY, dummyPayload);
  t.assert.equal(typeof sig, 'string');
  t.assert.equal(sig.startsWith('0x'), true);
  t.assert.equal(sig.length, 132); // 65 bytes = 130 hex + '0x'

  const recovered = recoverPayloadSigner(CHAIN_ID, REGISTRY, dummyPayload, sig);
  t.assert.equal(recovered.toLowerCase(), wallet1.address.toLowerCase());
});

test('recoverPayloadSigner returns different address when signed by different wallet', async (t) => {
  const sig2 = await signPayload(wallet2, CHAIN_ID, REGISTRY, dummyPayload);
  const recovered = recoverPayloadSigner(CHAIN_ID, REGISTRY, dummyPayload, sig2);
  t.assert.equal(recovered.toLowerCase(), wallet2.address.toLowerCase());
  t.assert.notEqual(recovered.toLowerCase(), wallet1.address.toLowerCase());
});

test('recoverPayloadSigner detects payload tampering', async (t) => {
  const sig = await signPayload(wallet1, CHAIN_ID, REGISTRY, dummyPayload);
  const tamperedPayload = dummyPayload.slice(0, -2) + '99';
  const recovered = recoverPayloadSigner(CHAIN_ID, REGISTRY, tamperedPayload, sig);
  t.assert.notEqual(recovered.toLowerCase(), wallet1.address.toLowerCase());
});

test('recoverPayloadSigner detects chainId mismatch', async (t) => {
  const sig = await signPayload(wallet1, CHAIN_ID, REGISTRY, dummyPayload);
  const wrongChainId = 1; // Ethereum Mainnet
  const recovered = recoverPayloadSigner(wrongChainId, REGISTRY, dummyPayload, sig);
  t.assert.notEqual(recovered.toLowerCase(), wallet1.address.toLowerCase());
});

test('recoverPayloadSigner detects registry address mismatch', async (t) => {
  const sig = await signPayload(wallet1, CHAIN_ID, REGISTRY, dummyPayload);
  const wrongRegistry = '0x4444444444444444444444444444444444444444';
  const recovered = recoverPayloadSigner(CHAIN_ID, wrongRegistry, dummyPayload, sig);
  t.assert.notEqual(recovered.toLowerCase(), wallet1.address.toLowerCase());
});

test('recoverPayloadSigner handles null, empty, or missing signatures gracefully', (t) => {
  t.assert.equal(recoverPayloadSigner(CHAIN_ID, REGISTRY, dummyPayload, null), ZERO_ADDRESS);
  t.assert.equal(recoverPayloadSigner(CHAIN_ID, REGISTRY, dummyPayload, ''), ZERO_ADDRESS);
});

test('recoverPayloadSigner normalizes 0/1 v values to 27/28', async (t) => {
  const sig = await signPayload(wallet1, CHAIN_ID, REGISTRY, dummyPayload);
  const rawV = parseInt(sig.slice(130, 132), 16);
  const vNormalizedToZeroOrOne = rawV >= 27 ? rawV - 27 : rawV;
  const zeroOneSig = sig.slice(0, 130) + vNormalizedToZeroOrOne.toString(16).padStart(2, '0');
  const recovered = recoverPayloadSigner(CHAIN_ID, REGISTRY, dummyPayload, zeroOneSig);
  t.assert.equal(recovered.toLowerCase(), wallet1.address.toLowerCase());
});
