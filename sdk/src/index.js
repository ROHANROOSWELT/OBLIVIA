// @oblivia/sdk — public surface.
export * from './abi.js';
export * from './dec.js';
export * from './client.js';
export * from './txs.js';
export * from './vault-crypto.js';

import * as abi from './abi.js';
import * as decEngine from './dec.js';
import * as commitments from './vault-crypto.js';
import { TxFactory, withRegistry, decodeErasureCertified, registryContract } from './txs.js';
import { ObliviaReadClient, scopeKeyOf } from './client.js';

export const Oblivia = {
  abi,            // encodeOp / decodeOp / opIdOf / digestOf / sign / recover / bytes3
  dec: decEngine, // DEC v2 core + full + verify (stably hashed, chain-pinnable)
  commitments,    // dataRoot / nullifiers (pure, plaintext-free)
  txs: TxFactory, // unsigned calldata builders for guardian + executor flows
  withRegistry,
  decodeErasureCertified,
  registryContract,
  scopeKeyOf,
  Read: ObliviaReadClient,
};

export default Oblivia;
