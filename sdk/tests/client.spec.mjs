// @oblivia/sdk tests — read-only chain client and scope key derivation.
import { test } from 'node:test';
import { AbiCoder, id, keccak256 } from 'ethers';
import { ObliviaReadClient, scopeKeyOf } from '../src/client.js';
import { ZERO_SCOPE, bytes3, parseBytes3, STATUS, NOTARY } from '../src/abi.js';

const REGISTRY = '0x1111111111111111111111111111111111111111';
const POLICY = '0x2222222222222222222222222222222222222222';

test('scopeKeyOf produces deterministic keccak256(abi.encode(subjectId, scopeRef))', (t) => {
  const subj = id('subject-1');
  const scope = id('scope-1');
  const expected = keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32', 'bytes32'], [subj, scope]));

  t.assert.equal(scopeKeyOf(subj, scope), expected);
  t.assert.equal(scopeKeyOf(subj, scope), scopeKeyOf(subj, scope));
});

test('scopeKeyOf differentiates scopes and subjects', (t) => {
  const s1 = id('subject-1');
  const s2 = id('subject-2');
  const sc1 = id('scope-1');
  const sc2 = id('scope-2');

  t.assert.notEqual(scopeKeyOf(s1, sc1), scopeKeyOf(s2, sc1));
  t.assert.notEqual(scopeKeyOf(s1, sc1), scopeKeyOf(s1, sc2));
  t.assert.notEqual(scopeKeyOf(s1, ZERO_SCOPE), scopeKeyOf(s1, sc1));
});

// Matrix of scope keys
for (let i = 0; i < 20; i++) {
  test(`scopeKeyOf matrix iteration ${i}`, (t) => {
    const s = id(`subject-${i}`);
    const sc = id(`scope-${i}`);
    const key = scopeKeyOf(s, sc);
    t.assert.equal(key.startsWith('0x'), true);
    t.assert.equal(key.length, 66);
    t.assert.notEqual(key, scopeKeyOf(s, ZERO_SCOPE));
  });
}

test('ObliviaReadClient requires registry in constructor', (t) => {
  t.assert.throws(() => new ObliviaReadClient({}), /registry address is required/);
  t.assert.throws(() => new ObliviaReadClient({ policy: POLICY }), /registry address is required/);
});

test('ObliviaReadClient.fromDeployments initializes correctly', (t) => {
  t.assert.throws(() => ObliviaReadClient.fromDeployments(null), /missing \/ incomplete/);
  t.assert.throws(() => ObliviaReadClient.fromDeployments({}), /missing \/ incomplete/);

  const client = ObliviaReadClient.fromDeployments({
    EraseRegistry: REGISTRY,
    PolicyRegistry: POLICY,
  });
  t.assert.equal(client.registryAddress, REGISTRY);
  t.assert.equal(client.policyAddress, POLICY);
});

// Create a mock provider that intercepts eth_call queries
function createMockProvider(handler) {
  return {
    async call(tx) {
      return handler(tx);
    },
    async getNetwork() {
      return { chainId: 31337n };
    },
  };
}

test('ObliviaReadClient.subject decodes complete subject row', async (t) => {
  const abiCoder = AbiCoder.defaultAbiCoder();
  const mockSubjectRow = [
    '0x2222222222222222222222222222222222222222', // guardian
    '0x3333333333333333333333333333333333333333', // principal
    bytes3('CPP'),                                 // jurisdiction
    3n,                                            // policyVersion
    id('attestation-1'),                           // ageAttestationHash
    1700000000n,                                   // openedAt
    1780000000n,                                   // vestEligibleAt
    1n,                                            // nextBand
    false,                                         // vested
    1n,                                            // status (ACTIVE = 1)
    0n,                                            // erasedAt
    id('last-dec'),                                // lastDecHash
    2n,                                            // lastNotary (ATTESTOR = 2)
  ];

  const types = [
    'address', 'address', 'bytes3', 'uint96', 'bytes32',
    'uint64', 'uint64', 'uint8', 'bool', 'uint8',
    'uint64', 'bytes32', 'uint8'
  ];
  const encodedResult = abiCoder.encode(types, mockSubjectRow);

  const mockProvider = createMockProvider(() => encodedResult);
  const client = new ObliviaReadClient({ registry: REGISTRY, policy: POLICY }, mockProvider);

  const sub = await client.subject(id('test-subject'));
  t.assert.equal(sub.guardian.toLowerCase(), '0x2222222222222222222222222222222222222222');
  t.assert.equal(sub.jurisdiction, 'CPP');
  t.assert.equal(sub.policyVersion, 3);
  t.assert.equal(sub.status, STATUS.ACTIVE);
  t.assert.equal(sub.statusName, 'ACTIVE');
  t.assert.equal(sub.lastNotary, NOTARY.ATTESTOR);
  t.assert.equal(sub.lastNotaryName, 'ATTESTOR');
  t.assert.equal(sub.vested, false);
});

test('ObliviaReadClient.certificate checks DEC hash presence', async (t) => {
  const decHash = id('dec-1');
  const mockProvider = createMockProvider(() => decHash);
  const client = new ObliviaReadClient({ registry: REGISTRY }, mockProvider);

  const cert = await client.certificate(id('sub'), id('scope'));
  t.assert.equal(cert.decHash, decHash);
  t.assert.equal(cert.exists, true);
});

test('ObliviaReadClient.certificate detects missing certificate (ZERO_SCOPE)', async (t) => {
  const mockProvider = createMockProvider(() => ZERO_SCOPE);
  const client = new ObliviaReadClient({ registry: REGISTRY }, mockProvider);

  const cert = await client.certificate(id('sub'), id('scope'));
  t.assert.equal(cert.decHash, ZERO_SCOPE);
  t.assert.equal(cert.exists, false);
});

test('ObliviaReadClient.ghosted and forgotten check booleans', async (t) => {
  const abiCoder = AbiCoder.defaultAbiCoder();
  const mockProvider = createMockProvider(() => abiCoder.encode(['bool'], [true]));
  const client = new ObliviaReadClient({ registry: REGISTRY }, mockProvider);

  const isGhosted = await client.ghosted(id('sub'), id('scope'));
  t.assert.equal(isGhosted, true);

  const isForgotten = await client.forgotten(id('sub'));
  t.assert.equal(isForgotten, true);
});

test('ObliviaReadClient.policyFor parses active and inactive policies', async (t) => {
  const abiCoder = AbiCoder.defaultAbiCoder();

  // Test inactive policy (isActive returns false)
  const inactiveProvider = createMockProvider(() => abiCoder.encode(['bool'], [false]));
  const clientInactive = new ObliviaReadClient({ registry: REGISTRY, policy: POLICY }, inactiveProvider);
  const policyInactive = await clientInactive.policyFor('EUR');
  t.assert.equal(policyInactive.active, false);
  t.assert.equal(policyInactive.code, 'EUR');

  // Test active policy
  const activeVersionTuple = [
    5n, // version
    [
      18, // selfEraseAge
      365, // maxRetentionDays
      false, // profilingAllowed
      'GDPR Article 17', // statuteCite
      1700000000n, // effectiveAt
      true, // active
    ],
  ];
  const activeResult = abiCoder.encode(
    ['uint96', '(uint8,uint32,bool,string,uint64,bool)'],
    activeVersionTuple,
  );

  let callCount = 0;
  const activeProvider = createMockProvider(() => {
    callCount++;
    if (callCount === 1) return abiCoder.encode(['bool'], [true]); // isActive
    return activeResult; // activeVersion
  });

  const clientActive = new ObliviaReadClient({ registry: REGISTRY, policy: POLICY }, activeProvider);
  const p = await clientActive.policyFor('EUR');
  t.assert.equal(p.active, true);
  t.assert.equal(p.version, 5);
  t.assert.equal(p.selfEraseAge, 18);
  t.assert.equal(p.maxRetentionDays, 365);
  t.assert.equal(p.profilingAllowed, false);
  t.assert.equal(p.statuteCite, 'GDPR Article 17');
});

test('ObliviaReadClient.policyFor throws if policy address is missing', async (t) => {
  const client = new ObliviaReadClient({ registry: REGISTRY, policy: null }, {});
  await t.assert.rejects(async () => client.policyFor('CPP'), /no policy address on client/);
});

test('ObliviaReadClient.bindings and net return config snapshot', async (t) => {
  const abiCoder = AbiCoder.defaultAbiCoder();
  const addr = '0x4444444444444444444444444444444444444444';
  const mockProvider = createMockProvider(() => abiCoder.encode(['address'], [addr]));

  const client = new ObliviaReadClient({ registry: REGISTRY, policy: POLICY }, mockProvider);
  const b = await client.bindings();
  t.assert.equal(b.registry, REGISTRY);
  t.assert.equal(b.policyRegistry.toLowerCase(), addr.toLowerCase());

  const net = await client.net();
  t.assert.equal(net.chainId, 31337);
});
