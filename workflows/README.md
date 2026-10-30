# CRE workflow (DON path) — runbook, not vendored code

Oblivia's contractconsumer (`EraseRegistry`) implements Chainlink's `IReceiver`
interface, so the DON path is supported **when you run the CLI one-time setup**.
We deliberately do NOT ship un-recompilable scaffold code: the hub's ATTESTOR
path (hub key-signed `notarize()`) is fully live and provable locally today, and
this file describes the 5 real steps (and exact function calls) to switch the
executor to the DON.

## Why dual-notary

| Path | Executor | Signature authority | Status |
|---|---|---|---|
| ATTESTOR | hub/run-attestor.js (CLI) | hub hot key (`.attestor.json`), EIP-191 | **live now** |
| DON | Chainlink CRE workflow | Chainlink runtime (keccak256-signed report) | needs your one-time `cre workflow deploy`/approval |

The registry stamps the notary per receipt (`Notary.ATT` vs `Notary.DON`) — that
is exactly what the queue rows and DEC receipts show.

## The five steps (after binding your CRE tenant)

1. Register the CRE runtime key.
   ```
   cd hub && node --input-type=module -e "import('src/attestor.js').then(a => console.log(a.loadAttestorKey().address))"
   export ATTESTOR_ADDRESS=$(node ...)
   ```
   Case delegation: deploy the registry with `ATTESTOR_ADDRESS=<hub-key>` so
   `s_attestor == hub key` (TAKE CARE: the hub-map signer must equal the
   deployed `s_attestor`; scripts/run-local.sh does this automatically).
2. Local chain: with `forge --rpc-url` in one shell and
   `anvil --port 8545` in another, deploy `remappings` + `forge script` in the
   contracts directory (or `bash scripts/run-local.sh`).
3.钱包 fund the runtime:
   On a real chain the DON forwards from the registered `KeystoneForwarder`;
   get its address from scripting the CRE docs' `forwarder-directory.ts`
   snippet before deployment.
4. Call the hub directly in Reporter mode — the review path is the identity of
   `onReport()`:
   `src/workflow/notary.cre.ts`'s `onReport(bytes calldata metadata, bytes calldata report)`
   struct semantic: erasure `Op` is encoded exactly by `hub/src/abi.js#encodeOp`
   — any report ABI mismatch reverts `Replay` style, keeping the replay-proof.
5. Point the queue at the hub: the CRE cron workflow polls
   `GET {HUB_URL}/api/notary/next-op`, which returns `{ok, op: null}` unless an
   ERASE is QUEUED; the attestor loop backs off meanwhile. No double-execution
   is possible: `executedOp` replay guard makes the second call revert.

## Events to watch

`cast rpc` (or an arc explorer) can filter by contract topics:
- `SubjectOpened` — guardian opening a protected entity
- `ErasureRequested` — guardian's authority proof for one scope
- `ErasureCertified(subjectId, scopeRef, decHash, methodHash, notary, reason, erasedAt)`
  `Notary` index tells you if it came from `ATTESTOR` or `DON`
