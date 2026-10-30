# OBLIVIA — The Minor Rights Lifecycle Protocol

> *"Organizations say 'we deleted your child's data.' Verified by nobody, and impossible to prove.*
> *OBLIVIA turns that claim into a consensus-verified certificate — on chain, portable, court-ready."*

LegalTech & RegTech — BLI Legal Tech Hackathon 2 (DoraHacks)

## What actually happens (no mocks anywhere)

1. A guardian connects a real wallet (Base Sepolia) and **signs** their child's enrollment
   (EIP-712 guardianship + age-band attestation — a real, cryptographically signed act).
2. The child's data (AI-companion memories, app records) is stored **encrypted** (AES-256-GCM)
   with a per-record 256-bit salt. Only `keccak256(salt ++ dataRoot)` ever reaches the chain.
3. **Erasure** destroys the salt (cryptographic shredding) and the registry ratchets
   `ACTIVE → ERASED` forever, emitting a **Digital Erasure Certificate** hash + nullifier.
4. Every act on the record is verifiable: guardian signatures (verify on-chain via `ecrecover`),
   live policy from `PolicyRegistry`, verifier checking `keccak256(certJSON) == decHash`
   stored in the registry, and DON-notarized reports delivered by a Chainlink forwarder.

## The three pillars

| Pillar | Where |
|---|---|
| Policy Warden — jurisdiction & age-band rule tables as **live on-chain data** | `contracts/src/PolicyRegistry.sol` |
| Rights Vesting — guardian powers expire at the statutory age threshold; the adult claims their own history | `EraseRegistry.vestRights` (attested) |
| Evidence Engine — Digital Erasure Certificates (DEC), hash-pinned on chain, verifier-recomputable | `hub/src/dec.js` + registry |

## Repo layout

```
contracts/   Foundry: PolicyRegistry, EraseRegistry (Chainlink IReceiver consumer), tests, deploy script
hub/         Express MPA server: vault (real AES-GCM + salts), ops queue, DEC engine, chain reads, notary spawn
workflows/   Chainlink CRE TypeScript workflow (cron notary → signed report → forwarder write)
web/         The multi-page app (8 real pages, wallet-state machine, zero build step)
scripts/     run-local.sh (anvil all-in-one), deploy.sh (Base Sepolia)
```

## Quickstart (local, 2 minutes)

```bash
bash scripts/run-local.sh
# → anvil (local chain), contracts deployed, hub on http://localhost:8080
# open http://localhost:8080  → Guardian console → enroll a "kid"
# then the Kid page (oblib companion), Forget me, Passport, Explorer, Verify
```

## Testnet (Base Sepolia)

```bash
# 1. get test ETH: https://faucet.base.org (or bridge a sprinkle of Sepolia)
# 2. configure
cp .env.example .env   # fill PRIVATE_KEY (burner), RPC_URL_BASE=https://sepolia.base.org
bash scripts/deploy.sh  # deploys + prints Basescan links, writes hub/deployments.json
# 3. run hub with .env loaded; CRE workflow (optional, see workflows/README.md):
cre login && cre workflow simulate notary --broadcast --target ...
```

Notarization levels are explicit on every record: `DON` (production forwarder) >
`DON_SIM` (signed report recorded by Base Sepolia MockForwarder `0x8230...f3e5`) >
`ATTESTOR` (hub key, guardian EIP-712 verified in-wallet, fully on-chain).

## Status

See `docs/SUBMISSION.md` for: build log, judge walkthrough, open claims & limits
(what we promise vs what a production deploy adds).
