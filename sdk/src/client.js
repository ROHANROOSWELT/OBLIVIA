// @oblivia/sdk — read-only chain client. Fires eth_calls against a real
// RPC; no caching, no placeholders. Returns decoded object-shaped results.
import { AbiCoder, Contract, ethers, keccak256 } from 'ethers';
import { bytes3, parseBytes3, hexBytes32, ZERO_SCOPE, STATUS, NOTARY } from './abi.js';

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
];

const POLICY_ABI = [
  'function activeVersion(bytes3) view returns (uint96, (uint8 selfEraseAge, uint32 maxRetentionDays, bool profilingAllowed, string statuteCite, uint64 effectiveAt, bool active))',
  'function isActive(bytes3) view returns (bool)',
];

export function scopeKeyOf(subjectId, scopeRef) {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(['bytes32', 'bytes32'], [hexBytes32(subjectId), hexBytes32(scopeRef)]),
  );
}

/**
 * ObliviaReadClient — the verifier-integrator surface. Defaults to sensible
 * local RPC; pass `provider` (ethers v6 Provider) for anything else.
 */
export class ObliviaReadClient {
  constructor({ registry, policy }, provider = null) {
    if (!registry) throw new Error('registry address is required');
    this.provider = provider ?? new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://127.0.0.1:8545');
    this.registryAddress = registry;
    this.policyAddress = policy ?? null;
    this._registry = new Contract(registry, REGISTRY_ABI, this.provider);
    this._policy = policy ? new Contract(policy, POLICY_ABI, this.provider) : null;
  }

  static fromDeployments(deployments, provider) {
    if (!deployments || !deployments.EraseRegistry) {
      throw new Error('deployments.json missing / incomplete');
    }
    return new ObliviaReadClient(
      { registry: deployments.EraseRegistry, policy: deployments.PolicyRegistry },
      provider ?? new ethers.JsonRpcProvider(process.env.RPC_URL || 'http://127.0.0.1:8545'),
    );
  }

  /** Full subject row (chain truth); jurisdiction returns the ASCII code. */
  async subject(subjectId) {
    const r = await this._registry.subjects(hexBytes32(subjectId));
    return {
      guardian: r[0],
      principal: r[1],
      jurisdiction: parseBytes3(r[2]),
      policyVersion: Number(r[3]),
      ageAttestationHash: r[4],
      openedAt: Number(r[5]),
      vestEligibleAt: Number(r[6]),
      nextBand: Number(r[7]),
      vested: r[8],
      status: Number(r[9]),
      statusName: Object.entries(STATUS).find(([, v]) => v === Number(r[9]))?.[0] ?? null,
      erasedAt: Number(r[10]),
      lastDecHash: r[11],
      lastNotary: Number(r[12]),
      lastNotaryName: Object.entries(NOTARY).find(([, v]) => v === Number(r[12]))?.[0] ?? null,
    };
  }

  /** certificate for a scope (decHash) + the scopeKey the registry stores it under */
  async certificate(subjectId, scopeRef) {
    const key = scopeKeyOf(subjectId, scopeRef ?? ZERO_SCOPE);
    const decHash = await this._registry.certificates(key);
    return { scopeKey: key, decHash, exists: decHash !== ZERO_SCOPE };
  }

  async ghosted(subjectId, scopeRef = ZERO_SCOPE) {
    return this._registry.ghosted(scopeKeyOf(subjectId, scopeRef));
  }

  async forgotten(subjectId) {
    return this._registry.forgotten(hexBytes32(subjectId));
  }

  /** Live policy row for a jurisdiction, or { onChain: true, active: false } */
  async policyFor(code) {
    if (!this._policy) throw new Error('no policy address on client');
    const k = bytes3(code);
    const active = await this._policy.isActive(k);
    if (!active) return { onChain: true, active: false, code };
    const [version, pv] = await this._policy.activeVersion(k);
    return {
      onChain: true,
      active: true,
      code,
      version: Number(version),
      selfEraseAge: Number(pv.selfEraseAge),
      maxRetentionDays: Number(pv.maxRetentionDays),
      profilingAllowed: pv.profilingAllowed,
      statuteCite: pv.statuteCite,
      effectiveAt: Number(pv.effectiveAt),
    };
  }

  /** configuration snapshot (attestor key, forwarder, owner, policy binding) */
  async bindings() {
    const [policyRegistry, attestor, forwarder, owner] = await Promise.all([
      this._registry.policyRegistry(),
      this._registry.s_attestor(),
      this._registry.s_forwarder(),
      this._registry.owner(),
    ]);
    return { policyRegistry, attestor, forwarder, owner, registry: this.registryAddress };
  }

  async net() {
    const n = await this.provider.getNetwork();
    return { chainId: Number(n.chainId) };
  }
}
