# OBLIVIA — The Minor Rights Lifecycle Protocol

> *"Organizations say 'we deleted your child's data.' Verified by nobody, impossible to prove.*
> *OBLIVIA turns that claim into a notarized, statute-bound receipt — on chain, portable, court-ready."*

LegalTech & RegTech — BLI Legal Tech Hackathon 2 (DoraHacks)

## No PII goes on chain — ever

All chain bindings are hashes / pseudonyms / addresses. What the hub holds is
ciphertext encrypted in the GUARDIAN'S browser (AES-256-GCM, PBKDF2-derived key
from a passphrase that never leaves the browser); the hub keeps only
(iv | tag | ciphertext) and can prove what it held only via the DEC nullifiers.

## The three pillars

| Pillar | Where | Judged via |
|---|---|---|
| Policy Warden — jurisdiction rule tables as live on-chain data | `contracts/src/PolicyRegistry.sol` | `/` landing + `/guardian` policy chips read `activeVersion()` LIVE |
| Rights Vesting — guardian authority expires at the statutory threshold; adult claims their own rights | `EraseRegistry` kind-3 ops | contract tests + `/docs` |
| Erasure Evidence Engine — DEC v2 core hash pinned on chain, item nullifiers recomputable from ciphertext hashes | `hub/src/dec.js`, `hub/src/server.js#confirmed` | `/verify:hash` rehash + chain `certificates(scopeKey)` read |

## Repo layout

```
contracts/   Foundry: PolicyRegistry, EraseRegistry (Chainlink IReceiver consumer), 13 tests, deploy+seed
hub/         Express MPA server: vault (browser-enc AES-GCM storage), DEC v2 engine,
             notary queue, live chain reads, attestor executor loop; views/ = the 8 MPA pages
sdk/         @oblivia/sdk: op encoding, DEC v2 evidence, unsigned tx builders, chain client, 663 tests
workflows/   Dual-notary runbook (attestor path live; DON path = CRE CLI setup documented)
scripts/     run-local.sh (anvil + deploy + abi export), export-abi.mjs
```

## Quickstart (local, ~3 min)

```bash
bash scripts/run-local.sh          # anvil + deploy + seeded policies + ABI export
node hub/src/server.js             # hub on http://localhost:3000
# in another shell (executor loop; needs RPC + PRIVATE_KEY):
node hub/run-attestor.js
# or validate headlessly:
node hub/scripts/e2e.mjs           # → E2E OK (full lifecycle, includes real txs)
```

Pages: `/` (landing), `/guardian` (hero flow), `/kid/:subjectId`, `/passport/:subjectId`,
`/explorer`, `/cert/:decHash`, `/verify/:decHash`, `/seal`, `/docs`.

## Wallet authority (what is signed where)

| Act | Signed by | Proof |
|---|---|---|
| enroll (openSubject) | guardian wallet tx | on-chain `ErasureRequested`'d msg.sender |
| add memory | guardian wallet tx | `addMemory` authority check |
| request erasure (per scope or FULL) | guardian wallet tx | `requestMade` mapping — protocol refuses notarized ERASE w/o it |
| notarize payload execute | ANY wallet (permissionless) | hub-key EIP-191 signature on the exact payload verified on chain |
| vest (rights handover) | witness-relayed attestation | contract checks `vestEligibleAt` + `principal` |

## Notary levels (explicit per receipt)

- `ATTESTOR` — hub hot key signed, default executor, fully on-chain today.
- `DON` — Chainlink CRE Runtime Environment report delivered by the registered
  forwarder to `onReport()`; see `workflows/README.md` for the exact runbook
  (it requires your `cre login` + one-time approval; no invented components).

## Testnet (Base Sepolia)

```bash
cp .env.example .env          # PRIVATE_KEY (burner), RPC_URL=https://sepolia.base.org
bash scripts/deploy.sh        # env: PRIVATE_KEY (burner), ETHERSCAN_API_KEY (via Etherscan v2 API)
```

## Honest limits (see docs/SUBMISSION.md §limits)

- `nul`-scope (full erasure) is one op; per-scope erase exists.
- The hub is a demo-grade store (JSON file) — production swaps an append-only NOP log.
- ERC-8228 interop is noted in docs, not implemented.
