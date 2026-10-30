// Oblivia hub — live chain reader. Never returns cached/hardcoded numbers:
// every answer is re-queried from the configured RPC_URL; if the chain is
// down we say so instead of inventing data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { bytes3, ZERO_SCOPE } from './abi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUB_ROOT = path.resolve(__dirname, '..');
const DEPLOY_FILE = path.join(HUB_ROOT, 'deployments.json');

const REGISTRY_ABI = [
  'function subjects(bytes32) view returns (address guardian, address principal, bytes3 jurisdiction, uint96 policyVersion, bytes32 ageAttestationHash, uint64 openedAt, uint64 vestEligibleAt, uint8 nextBand, bool vested, uint8 status, uint64 erasedAt, bytes32 lastDecHash, uint8 lastNotary)',
  'function certificates(bytes32) view returns (bytes32)',
  'function ghosted(bytes32) view returns (bool)',
  'function forgotten(bytes32) view returns (bool)',
  'function opIdOf(uint8,bytes32,bytes32) view returns (bytes32)',
  'function policyRegistry() view returns (address)',
  'function s_attestor() view returns (address)',
  'function s_forwarder() view returns (address)',
  'function owner() view returns (address)',
  'function notarize(bytes,bytes)',
  'function openSubject(bytes32,bytes3,bytes32,bytes32,uint64,uint8)',
  'function addMemory(bytes32,bytes32,bytes32)',
  'function requestErasure(bytes32,bytes32)',
];

const POLICY_ABI = [
  'function activeVersion(bytes3) view returns (uint96, (uint8 selfEraseAge, uint32 maxRetentionDays, bool profilingAllowed, string statuteCite, uint64 effectiveAt, bool active))',
  'function isActive(bytes3) view returns (bool)',
];

function readDeployments() {
  try {
    if (fs.existsSync(DEPLOY_FILE)) {
      return JSON.parse(fs.readFileSync(DEPLOY_FILE, 'utf8'));
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

let cached = { mtime: 0, provider: null, registry: null, policy: null, deploy: null };

function connect() {
  let mtime = 0;
  try {
    mtime = fs.statSync(DEPLOY_FILE).mtimeMs;
  } catch {
    /* no file yet */
  }
  if (cached.provider && cached.provider._obliviaLoaded === mtime) {
    return cached;
  }
  const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:8545';
  const deploy = cached.deploy && cached.deploy.chainId ? cached.deploy : readDeployments();
  cached = { mtime, provider: new ethers.JsonRpcProvider(rpcUrl), registry: null, policy: null, deploy };
  cached.provider._obliviaLoaded = mtime;
  if (deploy) {
    cached.registry = new ethers.Contract(deploy.EraseRegistry, REGISTRY_ABI, cached.provider);
    cached.policy = new ethers.Contract(deploy.PolicyRegistry, POLICY_ABI, cached.provider);
  }
  return cached;
}

export function chainStatus() {
  const { provider, deploy } = connect();
  const network = { rpc: process.env.RPC_URL || 'http://127.0.0.1:8545', deployed: !!deploy };
  return provider
    .getBlockNumber()
    .then(async (blockNumber) => {
      let gasPrice = null;
      try {
        gasPrice = (await provider.getFeeData()).gasPrice?.toString() ?? null;
      } catch {
        /* ignore */
      }
      return {
        ok: true,
        blockNumber,
        gasPrice,
        chain: network,
        deploy,
      };
    })
    .catch((e) => ({ ok: false, error: String(e?.shortMessage || e), chain: network, deploy }));
}

export async function policyFor(jurisdictionCode) {
  const { policy } = connect();
  if (!policy) return { onChain: false };
  try {
    const code = bytes3(jurisdictionCode);
    const active = await policy.isActive(code);
    if (!active) return { onChain: true, active: false };
    const [version, pv] = await policy.activeVersion(code);
    return {
      onChain: true,
      active: true,
      version: Number(version),
      selfEraseAge: Number(pv.selfEraseAge),
      maxRetentionDays: Number(pv.maxRetentionDays),
      profilingAllowed: pv.profilingAllowed,
      statuteCite: pv.statuteCite,
      effectiveAt: Number(pv.effectiveAt),
    };
  } catch (e) {
    return { onChain: true, error: String(e?.shortMessage || e) };
  }
}

export async function subjectOnChain(subjectId) {
  const store = connect();
  if (!store.registry) return { onChain: false };
  const reg = store.registry;
  try {
    const id = typeof subjectId === 'string' ? subjectId : '0x' + '0'.repeat(64);
    const [g, p, jur, pv, age, opened, vestAt, band, vested, status, erasedAt, lastDec, lastNotary] =
      await reg.subjects(id);
    const S = {
      onChain: true,
      guardian: g,
      principal: p,
      jurisdiction: Buffer.from(jur.slice(2).replace(/(00)+$/, ''), 'hex').toString('ascii').trim(),
      policyVersion: Number(pv),
      ageAttestationHash: age,
      openedAt: Number(opened),
      vestEligibleAt: Number(vestAt),
      nextBand: Number(band),
      vested,
      status: Number(status),
      erasedAt: Number(erasedAt),
      lastDecHash: lastDec,
      lastNotary: Number(lastNotary),
    };
    return S;
  } catch (e) {
    return { onChain: true, error: String(e?.shortMessage || e) };
  }
}

export async function certificateFor(subjectId, scopeRef) {
  const { registry } = connect();
  if (!registry) return { onChain: false };
  try {
    const scopeKey = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(['bytes32', 'bytes32'], [subjectId, scopeRef]),
    );
    const decHash = await registry.certificates(scopeKey);
    return { onChain: true, exists: decHash !== ZERO_SCOPE, decHash, scopeKey };
  } catch (e) {
    return { onChain: true, error: String(e?.shortMessage || e) };
  }
}

export async function forgeBindings() {
  const deploy = readDeployments();
  if (!deploy) return null;
  const { registry } = connect();
  try {
    const [lang, attestor, forwarder, owner] = await Promise.all([
      registry.policyRegistry(),
      registry.s_attestor(),
      registry.s_forwarder(),
      registry.owner(),
    ]);
    return { deploy, policyRegistry: lang, attestor, forwarder, owner };
  } catch (e) {
    return { deploy, error: String(e?.shortMessage || e) };
  }
}

export function deployments() {
  return readDeployments();
}

export { ethers };
