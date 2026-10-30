// @oblivia/sdk — tx builders + log decoders. Produces UNSIGNED calldata so
// an integrator can stack OBLIVIA onto any wallet stack (MetaMask, Safe,
// ERC-4337 bundler, a cron executor) without our opinion about signing.
import { Contract, Interface } from 'ethers';
import { bytes3, hexBytes32, ZERO_SCOPE } from './abi.js';

const REGISTRY_HUMAN = [
  'function openSubject(bytes32 subjectId, bytes3 jurisdiction, bytes32 ageAttestationHash, bytes32 dataRootCommitment, uint64 vestEligibleAt, uint8 nextBand)',
  'function addMemory(bytes32 subjectId, bytes32 scopeRef, bytes32 dataCommitment)',
  'function requestErasure(bytes32 subjectId, bytes32 scopeRef)',
  'function notarize(bytes payload, bytes sig)',
  'event ErasureCertified(bytes32 indexed subjectId, bytes32 indexed scopeRef, bytes32 decHash, bytes32 methodHash, uint8 notary, uint8 reason, uint64 erasedAt)',
  'event SubjectOpened(bytes32 indexed subjectId, bytes3 jurisdiction, uint96 policyVersion, address guardian, bytes32 ageAttestationHash, bytes32 dataRootCommitment, uint64 vestEligibleAt, uint8 nextBand)',
  'event RightsVested(bytes32 indexed subjectId, address indexed principal, uint8 nextBand, uint64 vestedAt)',
  'event ReportReceived(bytes32 marker, bytes report)',
];

const IFACE = new Interface(REGISTRY_HUMAN);

/**
 * build calldata for the four guardian/executor entry points.
 * Every returned object {to, data} is ready for eth_sendTransaction /
 * eth_sendRawTransaction / Safe relay, unchanged.
 */
export const TxFactory = {
  openSubject({ subjectId, jurisdiction, ageAttestationHash, dataRootCommitment, vestEligibleAt, nextBand }) {
    return {
      data: IFACE.encodeFunctionData('openSubject', [
        hexBytes32(subjectId),
        bytes3(jurisdiction),
        hexBytes32(ageAttestationHash),
        hexBytes32(dataRootCommitment),
        vestEligibleAt ?? 0,
        nextBand ?? 0,
      ]),
      selector: IFACE.getFunction('openSubject').selector,
    };
  },
  addMemory({ subjectId, scopeRef, dataCommitment }) {
    return {
      data: IFACE.encodeFunctionData('addMemory', [
        hexBytes32(subjectId),
        scopeRef == null ? ZERO_SCOPE : hexBytes32(scopeRef),
        hexBytes32(dataCommitment),
      ]),
      selector: IFACE.getFunction('addMemory').selector,
    };
  },
  requestErasure({ subjectId, scopeRef }) {
    return {
      data: IFACE.encodeFunctionData('requestErasure', [
        hexBytes32(subjectId),
        scopeRef == null ? ZERO_SCOPE : hexBytes32(scopeRef),
      ]),
      selector: IFACE.getFunction('requestErasure').selector,
    };
  },
  notarize({ payload, sig }) {
    if (!payload || !sig) throw new Error('notarize requires payload + sig');
    return {
      data: IFACE.encodeFunctionData('notarize', [payload, sig]),
      selector: IFACE.getFunction('notarize').selector,
    };
  },
};

/** Attach a destination address → ready-to-send unsigned tx objects. */
export function withRegistry(registryAddress, fn) {
  const { data, selector } = fn;
  return { to: registryAddress, data, selector };
}

/** Decode receipt logs — find the DEC + notary path stamped by the registry. */
export function decodeErasureCertified(receiptOrLogs) {
  const logs = Array.isArray(receiptOrLogs) ? receiptOrLogs : receiptOrLogs?.logs ?? [];
  const topic = IFACE.getEvent('ErasureCertified').topicHash;
  for (const log of logs) {
    if (log.topics?.[0]?.toLowerCase() !== topic.toLowerCase()) continue;
    const parsed = IFACE.parseLog(log);
    if (!parsed || parsed.name !== 'ErasureCertified') continue;
    return {
      subjectId: parsed.args.subjectId,
      scopeRef: parsed.args.scopeRef,
      decHash: parsed.args.decHash,
      methodHash: parsed.args.methodHash,
      notaryPath: Number(parsed.args.notary) === 1 ? 'DON' : Number(parsed.args.notary) === 2 ? 'ATTESTOR' : 'NONE',
      reason: Number(parsed.args.reason) === 1 ? 'REQUEST' : 'SUNSET',
      erasedAt: Number(parsed.args.erasedAt),
    };
  }
  return null;
}

/** helper for integrations that keep a signed Contract instance around */
export function registryContract(registryAddress, signerOrProvider) {
  return new Contract(registryAddress, REGISTRY_HUMAN, signerOrProvider);
}
