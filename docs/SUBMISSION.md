# docs/SUBMISSION.md

## What this build is

OBLIVIA is a **rights lifecycle protocol for a parent/guardian erasing a
minor's data trail under a named privacy statute** — with an on-chain,
notarized, independently verifiable evidence trail.

We deliberately did NOT build:

- a "delete everything" button with a metaphorical toast — every transition is a real contract state change;
- a single-page automation dashboard — this is a Multi-Page Application with narrative pages each one routing to the hub's flows (enroll → consent → erase → certify → verify);
- any mocked chain data — the landing page, guardian policy chips, explorer and verify
  screens query `PolicyRegistry` / `EraseRegistry` / receipts **live** through the hub's read APIs.

## Stack

- **Chains:** Brooke Sepolias (local anvil; Base Sepolia config included, deploy script is pending polish — see limits), chain reads via ethers v6.
- **Contracts:** `PolicyRegistry` (live jurisdiction rule tables with versioned
  statute citations) + `EraseRegistry` (op engine, dual-notary receipts,
  replay-proof opIds, rights vesting). 13 forge tests all passing.
- **Hub:** Express MPA server. Browser-side AES-256-GCM for child memories
  (key never leaves the guardian's browser), queue-driven attestor executor,
  DEC v2 evidence engine with conservative "only issue after verified receipt"
  discipline. All lifecycle stages visible on `/seal` + `/explorer`.
- **Evidence:** DEC v2 coreHash goes ON CHAIN as the ERASE op's `hashA`; the
  full certificate (with nullifiers and receipt block) is recomputable in ANY
  browser via the deterministic canonical-JSON hash (`/verify`).

## Flow judged live (with the review judge wallet, 5 minutes)

1. `bash scripts/run-local.sh` + `node hub/src/server.js` + `node hub/run-attestor.js`
2. `/guardian`: connect MetaMask (or anvil #0 when demoing locally with cast),
   pick a jurisdiction chip (policy read from chain shows statute + ages),
   enroll (guardian wallet tx `openSubject`).
3. Add a "memory" (encrypted blob posted to hub, commitment + wallet tx
   `addMemory`).
4. "Request erasure (FULL)": wallet tx `requestErasure` → queue shows the op.
5. The attestor executor signs + broadcasts `notarize(...)`; op → CONFIRMED
   with DEC v2; the ciphertext is shredded hub-side.
6. `/cert/:decHash` + `/verify/:decHash`: recompute the canonical hash,
   compare with the on-chain `certificates()` read, show the mined tx.
7. `/docs`: statute citations + which field is where (for the rubric's
   "judges should not be confused by the architecture" criterion).

## Why this is a LegalTech/RegTech build, not a wallet demo

- **Named statutes as data.** A rule table keyed by jurisdiction codes
  (CPP → COPPA 2025 amendments, MDP → Maryland MODPA, EUR → GDPR,
  IND → DPDP Act 2023) with per-version statute citations, self-erase ages,
  retention caps and profiling bans. Changing the law changes the next
  enrollment WITHOUT redeploying; historical enrollments keep proving "this
  version was in effect at the time".
- **Authority geometry.** Every op declares WHO may do it (guardian, or the
  now-adult principal post-vesting) and the contract enforces it.
- **Erasure with evidence.** Notarized receipt + DEC nullifiers demonstrates
  the "delete ≠ disappear" honesty: we provide PROOF OF REMOVAL, not silence.
- **Interop claim tested against prior art.** As of 2026-11 the closest
  operator is Verifiable Delete's ERC-8228 receipt shape; our DEC carries
  statute + scope + authority that an EIP-712 receipt can be derived from for
  a follow-up adapter (declared in docs, not implemented).

## Screens

- `/` live policy tables + chain status (queries RPC LIVE — no mocks).
- `/guardian` the full hero flow on one page.
- `/seal` notary queue + one-click independent sealing.
- `/explorer` live queue + policy reads + receipts.
- `/verify` the independent verification (works even if the hub is offline).

## Limits (judges appreciate honesty)

1. The hub is a single-process demo (Express + JSON file storage); a
   production version would swap the vault/queue/DEC layer onto an audited MANIFEST
   log — the architecture (post-signed instruction queue) is unchanged.
2. `notarize()` caller: ANY wallet may seal a signed payload (the contract
   verifies the SIGNATURE). A judge can seal our signed payload from their own
   wallet — that is a feature (witness independence), not an attack.
3. CRE DON path requires tenant-side `cre login` and a one-time forwarder
   approval — see `workflows/README.md` for the runbook. The ATTESTOR path is
   fully live in this submission, and the DEC stamps notary path per receipt.
4. Age assurance itself is OUT of scope for this build (guardian declaration
   hash is IS the protocol currency; verifiable age-proof integrations are a
   follow-up (CLEAR).

## Repository map for the judge

- `contracts/test/EraseRegistry.t.sol` — the behavioral spec (13 tests).
- `hub/scripts/e2e.mjs` — the end-to-end pipeline (live txs on anvil), the
  exact endpoints the MPA uses.
- `hub/src/server.js` — precise request/response wiring for every page.
- `hub/src/dec.js` + `hub/src/vault.js` — evidence engine + zero-knowledge-ish storage plane.
