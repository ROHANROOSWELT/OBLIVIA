# @oblivia/sdk

> JavaScript/TypeScript SDK for the **OBLIVIA Minor Rights Lifecycle Protocol**.
> Provides canonical op encoding, dual-notary signature verification, DEC v2 cryptographic evidence generation, client-side commitment derivation, and unsigned EVM transaction builders.

[![Tests](https://img.shields.io/badge/tests-663%20passed-brightgreen.svg)]()
[![License](https://img.shields.io/badge/license-MIT-blue.svg)]()
[![Zero PII](https://img.shields.io/badge/chain%20PII-zero-success.svg)]()

---

## Features

- **Zero-PII On-Chain Commitments**: Pure client-side hash calculations (`dataRootOf`, `itemHash`, `nullifierFor`) without exposing plaintext.
- **Canonical ABI Encoders**: Byte-for-byte Solidity `abi.encode(Op)` parity with `EraseRegistry.sol` and the hub.
- **Dual-Notary Protocol Support**: Cryptographic primitives supporting both `ATTESTOR` (EIP-191 hub signatures) and `DON` (Chainlink CRE reports).
- **DEC v2 Evidence Engine**: Build and verify chain-pinnable Decommissioned Data Certificates with deterministic JSON canonicalization.
- **Unsigned Transaction Builders**: Modular `TxFactory` functions that output ready-to-sign calldata compatible with MetaMask, Safe, ERC-4337 bundlers, or custom executors.
- **Read-Only Chain Client**: Type-safe queries for subject status, live jurisdiction policies, ghosted scopes, and erasure certificates.

---

## Installation

```bash
npm install @oblivia/sdk ethers
```

---

## Quickstart

```javascript
import { Oblivia, bytes3, ZERO_SCOPE } from '@oblivia/sdk';
import { Wallet, id } from 'ethers';

// 1. Compute zero-PII data commitments for encrypted items
const items = [
  { memoryId: 'item-1', iv: '0x12..', tag: '0x34..', cipher: '0x56..' },
];
const dataRoot = Oblivia.commitments.dataRootOf(items);

// 2. Build unsigned transaction for guardian enrollment
const openTx = Oblivia.txs.openSubject({
  subjectId: id('pseudonym-subject-1'),
  jurisdiction: 'CPP', // US COPPA
  ageAttestationHash: id('attestation-doc-hash'),
  dataRootCommitment: dataRoot,
  vestEligibleAt: 1780000000,
  nextBand: 1,
});

// 3. Generate DEC v2 erasure certificate evidence
const { dec, coreHash } = Oblivia.dec.buildDecCore({
  subjectId: id('pseudonym-subject-1'),
  jurisdiction: 'CPP',
  statuteCite: '15 U.S.C. 6501 COPPA Rule § 312.10',
  policyVersion: 1,
  scopeRef: ZERO_SCOPE, // FULL erasure
  actor: '0xGuardianWalletAddress...',
  actorAuthority: 'GUARDIAN',
  itemNullifiers: items.map(Oblivia.commitments.nullifierFor),
  chainId: 84532, // Base Sepolia
  opId: id('op-erase-1'),
});

// 4. Verify DEC certificates
const verification = Oblivia.dec.verifyDec(dec, { coreHash });
console.log('Valid certificate:', verification.ok); // true
```

---

## Module Overview

### 1. `Oblivia.abi` — Struct Encoding & Dual-Notary Verification
- `encodeOp(op)`: Encodes an `Op` struct matching `EraseRegistry.sol`'s `abi.encode(Op)`.
- `decodeOp(payloadHex)`: Decodes raw bytecode into typed struct properties.
- `opIdOf(chainId, registry, op)`: Deterministic op ID calculation for replay prevention.
- `digestOf(chainId, registry, payloadHex)`: Computes the EIP-191 digest verified by the smart contract.
- `signPayload(signer, chainId, registry, payloadHex)`: Signs an op with an attestor hot key.
- `recoverPayloadSigner(chainId, registry, payloadHex, sig)`: Recovers the attestor address from the signature.
- `bytes3(code)` / `parseBytes3(hex)`: Converts 3-letter jurisdiction codes (e.g., `'CPP'`, `'MDP'`, `'EUR'`, `'IND'`) to/from EVM `bytes3`.

### 2. `Oblivia.dec` — DEC v2 Evidence Engine
- `buildDecCore(inputs)`: Generates the pre-receipt certificate whose `coreHash` is pinned on chain.
- `buildDecFull(inputs, receipt)`: Combines the core certificate with execution receipt metadata (`erasureTxHash`, `blockNumber`, `notary`).
- `verifyDec(dec, { coreHash, fullHash })`: Independently verifies evidence integrity against tampering.
- `stableStringify(obj)`: Deterministic RFC 8785-compliant JSON serializer.
- `decHashOf(dec)`: Computes keccak256 hash over canonical JSON.

### 3. `Oblivia.commitments` — Vault Cryptography
- `itemHash(item)`: Computes `keccak256(iv || tag || cipher)` for an encrypted item.
- `nullifierFor(item)`: Returns single-item erasure nullifier.
- `dataRootOf(items)`: Permutation-invariant Merkle root of item hashes sorted by `memoryId`.
- `nullifiersFiltered(items, scopeRefFilter)`: Filters and computes nullifiers by scope.

### 4. `Oblivia.txs` — Transaction Builders
- `TxFactory.openSubject(...)`: Returns unsigned calldata for `openSubject`.
- `TxFactory.addMemory(...)`: Returns unsigned calldata for `addMemory`.
- `TxFactory.requestErasure(...)`: Returns unsigned calldata for `requestErasure`.
- `TxFactory.notarize(...)`: Returns unsigned calldata for permissionless `notarize`.
- `withRegistry(registryAddress, fn)`: Binds calldata to a destination address `{ to, data, selector }`.
- `decodeErasureCertified(receiptOrLogs)`: Decodes `ErasureCertified` events from transaction logs.

### 5. `Oblivia.Read` — Read-Only Chain Client
- `new Oblivia.Read({ registry, policy }, provider)`: Initializes typed read client.
- `client.subject(subjectId)`: Queries full subject lifecycle record from chain.
- `client.certificate(subjectId, scopeRef)`: Looks up registered DEC hash for a scope.
- `client.policyFor(code)`: Reads live jurisdiction parameters from `PolicyRegistry`.
- `client.ghosted(subjectId, scopeRef)` / `client.forgotten(subjectId)`: Checks erasure ratchets.

---

## Test Suite

The test suite includes comprehensive unit tests, structural matrix tests, cryptographic permutation invariance tests, and property-based fuzzing:

```bash
npm test
```

```
ℹ tests 663
ℹ suites 0
ℹ pass 663
ℹ fail 0
ℹ duration_ms 703ms
```

---

## License

MIT © Blockchain Legal Institute / OBLIVIA Protocol
