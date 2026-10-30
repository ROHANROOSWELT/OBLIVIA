// Oblivia hub — hub attestor key management (ATTESTOR notary path).
// Loads the key from HUB_ATTESTOR_KEY env, else auto-generates and persists it
// in hub/.attestor.json so local / jury sessions are reproducible.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers, Wallet, SigningKey } from 'ethers';
import { digestOf, encodeOp, opIdOf } from './abi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.resolve(__dirname, '..');
const KEY_FILE = path.join(HUB_ROOT, '.attestor.json');

export function loadAttestorKey(env = process.env) {
  if (env.HUB_ATTESTOR_KEY) {
    return new Wallet(env.HUB_ATTESTOR_KEY);
  }
  if (fs.existsSync(KEY_FILE)) {
    const j = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
    return new Wallet(j.privateKey);
  }
  const w = Wallet.createRandom();
  fs.writeFileSync(
    KEY_FILE,
    JSON.stringify({ address: w.address, privateKey: w.privateKey }, null, 2),
  );
  fs.chmodSync(KEY_FILE, 0o600);
  return new Wallet(w.privateKey);
}

/** Sign an encoded op payload exactly like the on-chain notarize() verifier expects. */
export async function attestorSign(attestor, chainId, registryAddress, payloadHex) {
  const digest = digestOf(chainId, registryAddress, payloadHex);
  // ethers signs the 32-byte digest per EIP-191 ("\x19Ethereum Signed Message:\n32")
  return attestor.signMessage(ethers.getBytes(digest));
}
