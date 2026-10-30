// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title EraseRegistry — Oblivia's on-chain rights ledger (Chainlink IReceiver consumer)
 *
 * Invariants
 * ----------
 * 1. Zero PII on chain: subjectId = client-generated pseudonym; only hashes live here
 *    (ageAttestationHash, dataRootCommitment, decHash, dataCommitment).
 * 2. One-way ratchet: ACTIVE -> ERASED on full-scope shredding; per-scope DEC hashes are
 *    permanent; erased scopes become "ghosts" (no longer re-creatable).
 * 3. Guardian authority is proven on chain: openSubject/addMemory/requestErasure are direct
 *    wallet txs (msg.sender). Attested/DON execution of an ERASE with reason REQUEST further
 *    requires THIS contract to hold the guardian's prior request for that exact scope.
 * 4. Two notary paths, stamped per certificate:
 *      DON      — signed CRE report delivered by the registered forwarder via onReport()
 *      ATTESTOR — ops payload signed by the registered hub key (guardian EIP-712 verified
 *                 wallet-side by the hub before queueing; deterministic opId = replay-proof)
 * 5. Live policy binding: enrollment pins the currently ACTIVE PolicyRegistry version.
 * 6. Rights Vesting: vesting only after vestEligibleAt (statutory age threshold); afterwards
 *    the principal (now-adult) holds the rights, not the guardian.
 *
 * IReceiver/onReport pattern follows Chainlink CRE "Building Consumer Contracts"
 * (ReceiverTemplate semantics; forwarder address configurable by owner).
 */

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

struct PolicyVersionView {
    uint8 selfEraseAge;
    uint32 maxRetentionDays;
    bool profilingAllowed;
    string statuteCite;
    uint64 effectiveAt;
    bool active;
}

interface IPolicyRegistry {
    function activeVersion(bytes3 code) external view returns (uint96 version, PolicyVersionView memory pv);
    function isActive(bytes3 code) external view returns (bool);
}

contract EraseRegistry is IReceiver, IERC165 {
    enum Status { NONE, ACTIVE, ERASED }
    enum Notary { NONE, DON, ATTESTOR }
    enum Reason { NONE, REQUEST, SUNSET }

    /// @dev Report payload (mirrored in hub/workflow TypeScript). void for all op kinds.
    struct Op {
        uint8 kind; // 0=ENROLL 1=MEMORY 2=ERASE 3=VEST
        uint8 reason; // for ERASE: 0=REQUEST 1=SUNSET
        bytes32 subjectId;
        bytes32 scopeRef; // ERASE: bytes32(0) == FULL-scope erasure
        bytes32 hashA; // ENROLL: dataRootCommitment | MEMORY: dataCommitment | ERASE: decHash
        bytes32 hashB; // ENROLL: ageAttestationHash | ERASE: methodHash
        address account; // ENROLL: guardian | VEST: principal
        uint96 policyVersion; // ENROLL (informational)
        bytes3 jurisdiction; // ENROLL
        uint64 vestEligibleAt; // ENROLL
        uint8 nextBand; // ENROLL (informational)
    }

    struct Subject {
        address guardian;
        address principal;
        bytes3 jurisdiction;
        uint96 policyVersion;
        bytes32 ageAttestationHash;
        uint64 openedAt;
        uint64 vestEligibleAt;
        uint8 nextBand;
        bool vested;
        Status status;
        uint64 erasedAt;
        bytes32 lastDecHash;
        Notary lastNotary;
    }

    address public owner;
    address public policyRegistry;
    address public s_forwarder; // registered forwarder; address(0) disables that check
    address public s_attestor; // registered hub key
    uint64 public constant MAX_VEST_HORIZON = 25 * 365 days;

    mapping(bytes32 => Subject) public subjects;
    /// scopeKey = keccak256(abi.encode(subjectId, scopeRef)) => DEC hash
    mapping(bytes32 => bytes32) public certificates;
    mapping(bytes32 => bool) public ghosted;
    mapping(bytes32 => bool) public forgotten;
    mapping(bytes32 => bool) public executedOp;
    /// requestMade[scopeKey] — set only by the guardian's own wallet tx (authority proof)
    mapping(bytes32 => bool) public requestMade;

    bytes32 public constant FULL_SCOPE = bytes32(0);
    bytes4 private constant _I_RECEIVER_ID = type(IReceiver).interfaceId;
    bytes4 private constant _I_ERC165_ID = type(IERC165).interfaceId;
    uint256 private constant _S_LIMIT =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    event SubjectOpened(
        bytes32 indexed subjectId,
        bytes3 jurisdiction,
        uint96 policyVersion,
        address guardian,
        bytes32 ageAttestationHash,
        bytes32 dataRootCommitment,
        uint64 vestEligibleAt,
        uint8 nextBand
    );
    event MemoryCommitted(bytes32 indexed subjectId, bytes32 indexed scopeRef, bytes32 dataCommitment, address byActor);
    event ErasureRequested(bytes32 indexed subjectId, bytes32 indexed scopeRef, address requester, uint64 requestedAt);
    event ErasureCertified(
        bytes32 indexed subjectId,
        bytes32 indexed scopeRef,
        bytes32 decHash,
        bytes32 methodHash,
        Notary notary,
        Reason reason,
        uint64 erasedAt
    );
    event RightsVested(bytes32 indexed subjectId, address indexed principal, uint8 nextBand, uint64 vestedAt);
    event ReportReceived(bytes32 marker, bytes report);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ForwarderSet(address indexed previous, address indexed current);
    event AttestorSet(address indexed previous, address indexed current);

    error Unauthorized();
    error AlreadyExists(bytes32 subjectId);
    error NotFound(bytes32 subjectId);
    error Ghosted(bytes32 subjectId, bytes32 scopeRef);
    error PolicyInactive(bytes3 jurisdiction);
    error BadSig();
    error Replay(bytes32 opId);
    error AlreadyVested(bytes32 subjectId);
    error NotVestedYet(uint64 vestEligibleAt, uint64 nowTs);
    error NotRequested(bytes32 scopeKey);
    error BadHorizon(uint64 at);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address _policyRegistry, address _forwarder, address _attestor) {
        owner = msg.sender;
        policyRegistry = _policyRegistry;
        s_forwarder = _forwarder;
        s_attestor = _attestor;
        emit OwnershipTransferred(address(0), owner);
        emit ForwarderSet(address(0), _forwarder);
        emit AttestorSet(address(0), _attestor);
    }

    // --------------------------------------------------------------- config
    function setForwarder(address a) external onlyOwner {
        emit ForwarderSet(s_forwarder, a);
        s_forwarder = a;
    }

    function setAttestor(address a) external onlyOwner {
        emit AttestorSet(s_attestor, a);
        s_attestor = a;
    }

    function transferOwnership(address a) external onlyOwner {
        emit OwnershipTransferred(owner, a);
        owner = a;
    }

    // ------------------------------------------------------------ guardians
    /// @notice Guardian opens the subject from their own wallet; live policy binding.
    function openSubject(
        bytes32 subjectId,
        bytes3 jurisdiction,
        bytes32 ageAttestationHash,
        bytes32 dataRootCommitment,
        uint64 vestEligibleAt,
        uint8 nextBand
    ) external {
        if (subjects[subjectId].status != Status.NONE) revert AlreadyExists(subjectId);
        if (forgotten[subjectId]) revert Ghosted(subjectId, FULL_SCOPE);
        if (vestEligibleAt > block.timestamp + MAX_VEST_HORIZON) revert BadHorizon(vestEligibleAt);
        _applyEnroll(subjectId, jurisdiction, ageAttestationHash, dataRootCommitment, vestEligibleAt, nextBand, msg.sender);
    }

    /// @notice Guardian (or vested principal) commits a data commitment for a scope.
    function addMemory(bytes32 subjectId, bytes32 scopeRef, bytes32 dataCommitment) external {
        Subject storage s = subjects[subjectId];
        if (s.status == Status.NONE) revert NotFound(subjectId);
        if (forgotten[subjectId]) revert Ghosted(subjectId, scopeRef);
        if (scopeRef == FULL_SCOPE) revert Ghosted(subjectId, scopeRef);
        bytes32 scopeKey = keccak256(abi.encode(subjectId, scopeRef));
        if (ghosted[scopeKey] || certificates[scopeKey] != bytes32(0)) revert Ghosted(subjectId, scopeRef);
        if (msg.sender != _actor(s)) revert Unauthorized();
        emit MemoryCommitted(subjectId, scopeRef, dataCommitment, msg.sender);
    }

    /// @notice Guardian (or vested principal) requests erasure of a scope (or FULL).
    function requestErasure(bytes32 subjectId, bytes32 scopeRef) external {
        Subject storage s = subjects[subjectId];
        if (s.status == Status.NONE) revert NotFound(subjectId);
        if (forgotten[subjectId]) revert Ghosted(subjectId, scopeRef);
        if (msg.sender != _actor(s)) revert Unauthorized();
        bytes32 scopeKey = keccak256(abi.encode(subjectId, scopeRef));
        if (ghosted[scopeKey] || certificates[scopeKey] != bytes32(0)) revert Ghosted(subjectId, scopeRef);
        requestMade[scopeKey] = true;
        emit ErasureRequested(subjectId, scopeRef, msg.sender, uint64(block.timestamp));
    }

    // ------------------------------------------------------------- notaries
    /// @notice ATTESTOR path: hub key relays a queued lifecycle op.
    /// payload = abi.encode(Op); sig = EIP-191 signing of keccak256(chainId, address(this), payload).
    function notarize(bytes calldata payload, bytes calldata sig) external {
        if (sig.length != 65) revert BadSig();
        if (s_attestor == address(0)) revert BadSig();
        bytes32 digest = keccak256(abi.encode(block.chainid, address(this), payload));
        if (_recover(_digest(digest), sig) != s_attestor) revert BadSig();
        _apply(abi.decode(payload, (Op)), Notary.ATTESTOR);
    }

    /// @dev IReceiver: DON path — forwarder validates DON signatures; we validate the origin.
    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (s_forwarder != address(0) && msg.sender != s_forwarder) revert Unauthorized();
        emit ReportReceived(bytes32(uint256(uint64(bytes8(metadata)))), report);
        _apply(abi.decode(report, (Op)), Notary.DON);
    }

    /// @dev Deterministic, replay-proof op id (hub + workflow + contract agree).
    function opIdOf(uint8 kind, bytes32 subjectId, bytes32 scopeRef) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), kind, subjectId, scopeRef));
    }

    // ---------------------------------------------------------- apply engine
    function _apply(Op memory op, Notary n) internal {
        bytes32 id = opIdOf(op.kind, op.subjectId, op.scopeRef);
        if (executedOp[id]) revert Replay(id);

        if (op.kind == 0) {
            if (subjects[op.subjectId].status != Status.NONE) revert AlreadyExists(op.subjectId);
            if (forgotten[op.subjectId]) revert Ghosted(op.subjectId, FULL_SCOPE);
            if (block.timestamp > op.vestEligibleAt + MAX_VEST_HORIZON) revert BadHorizon(op.vestEligibleAt);
            _applyEnroll(op.subjectId, op.jurisdiction, op.hashB, op.hashA, op.vestEligibleAt, op.nextBand, op.account);
        } else if (op.kind == 1) {
            Subject storage s = subjects[op.subjectId];
            if (s.status == Status.NONE) revert NotFound(op.subjectId);
            if (forgotten[op.subjectId]) revert Ghosted(op.subjectId, op.scopeRef);
            bytes32 scopeKey = keccak256(abi.encode(op.subjectId, op.scopeRef));
            if (ghosted[scopeKey] || certificates[scopeKey] != bytes32(0)) revert Ghosted(op.subjectId, op.scopeRef);
            emit MemoryCommitted(op.subjectId, op.scopeRef, op.hashA, op.account);
        } else if (op.kind == 2) {
            Subject storage s = subjects[op.subjectId];
            if (s.status == Status.NONE) revert NotFound(op.subjectId);
            if (op.reason == uint8(Reason.REQUEST)) {
                bytes32 scopeKey = keccak256(abi.encode(op.subjectId, op.scopeRef));
                if (!requestMade[scopeKey]) revert NotRequested(scopeKey);
            }
            _applyErase(op, n);
        } else if (op.kind == 3) {
            Subject storage s = subjects[op.subjectId];
            if (s.status != Status.ACTIVE) revert NotFound(op.subjectId);
            if (s.vested) revert AlreadyVested(op.subjectId);
            if (block.timestamp < s.vestEligibleAt) revert NotVestedYet(s.vestEligibleAt, uint64(block.timestamp));
            if (op.account == address(0)) revert BadSig();
            s.vested = true;
            s.principal = op.account;
            emit RightsVested(op.subjectId, op.account, s.nextBand, uint64(block.timestamp));
        } else {
            revert Unauthorized();
        }

        executedOp[id] = true;
    }

    function _applyEnroll(
        bytes32 subjectId,
        bytes3 jurisdiction,
        bytes32 ageHash,
        bytes32 dataRoot,
        uint64 vestEligibleAt,
        uint8 nextBand,
        address guardian
    ) internal {
        if (!IPolicyRegistry(policyRegistry).isActive(jurisdiction)) revert PolicyInactive(jurisdiction);
        (uint96 v, ) = IPolicyRegistry(policyRegistry).activeVersion(jurisdiction);
        subjects[subjectId] = Subject({
            guardian: guardian,
            principal: address(0),
            jurisdiction: jurisdiction,
            policyVersion: v,
            ageAttestationHash: ageHash,
            openedAt: uint64(block.timestamp),
            vestEligibleAt: vestEligibleAt,
            nextBand: nextBand,
            vested: false,
            status: Status.ACTIVE,
            erasedAt: 0,
            lastDecHash: bytes32(0),
            lastNotary: Notary.NONE
        });
        emit SubjectOpened(subjectId, jurisdiction, v, guardian, ageHash, dataRoot, vestEligibleAt, nextBand);
    }

    function _applyErase(Op memory op, Notary n) internal {
        Subject storage s = subjects[op.subjectId];
        bytes32 scopeKey = keccak256(abi.encode(op.subjectId, op.scopeRef));
        ghosted[scopeKey] = true;
        certificates[scopeKey] = op.hashA; // decHash
        s.erasedAt = uint64(block.timestamp);
        s.lastDecHash = op.hashA;
        s.lastNotary = n;
        if (op.scopeRef == FULL_SCOPE) {
            forgotten[op.subjectId] = true;
            s.status = Status.ERASED;
        }
        Reason r = op.reason == uint8(Reason.REQUEST) ? Reason.REQUEST : Reason.SUNSET;
        emit ErasureCertified(op.subjectId, op.scopeRef, op.hashA, op.hashB, n, r, uint64(block.timestamp));
    }

    // ------------------------------------------------------------- helpers
    function _actor(Subject storage s) internal view returns (address) {
        return s.vested ? s.principal : s.guardian;
    }

    function _digest(bytes32 h) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
    }

    function _recover(bytes32 digest, bytes memory sig) internal pure returns (address out) {
        bytes32 r;
        bytes32 s_;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s_ := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v = uint8(v + 27);
        if (v != 27 && v != 28) revert BadSig();
        if (uint256(s_) > _S_LIMIT) revert BadSig();
        out = ecrecover(digest, v, r, s_);
        if (out == address(0)) revert BadSig();
    }

    function supportsInterface(bytes4 interfaceId) external view override returns (bool) {
        return interfaceId == _I_RECEIVER_ID || interfaceId == _I_ERC165_ID;
    }
}
