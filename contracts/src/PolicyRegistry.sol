// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title PolicyRegistry — the Oblivia "Policy Warden"
 * @notice Jurisdiction & age-band rule tables stored as on-chain DATA (never hardcoded in apps).
 * Erasure semantics per jurisdiction (seeded at deploy, updatable by owner):
 *   - selfEraseAge: the statutory age at which the minor may demand erasure themselves
 *   - maxRetentionDays: statutory cap on how long app-held data may persist post-request
 *   - profilingAllowed: whether behavioral profiling of minors is permitted (DPDP: no)
 * Every Oblivia record pins the policyVersion it was created under; certificates cite it.
 */
contract PolicyRegistry {
    struct PolicyVersion {
        uint8 selfEraseAge; // years
        uint32 maxRetentionDays; // days after request before forced erasure is compliant
        bool profilingAllowed;
        string statuteCite; // human-readable legal basis, e.g. "16 CFR Part 312 (2025 amendments)"
        uint64 effectiveAt;
        bool active;
    }

    address public owner;
    mapping(bytes3 => uint96) public versionOf;
    mapping(bytes3 => mapping(uint96 => PolicyVersion)) private _versions;
    uint96 public totalVersionCount;
    mapping(bytes3 => uint32) public policyCount;

    event PolicyPublished(bytes3 indexed code, uint96 indexed version, string cite, uint64 effectiveAt);
    event PolicyDeactivated(bytes3 indexed code, uint96 indexed version);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error Unauthorized();
    error BadCode();
    error NotActive(bytes3 code);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address _owner) {
        owner = _owner == address(0) ? msg.sender : _owner;
        emit OwnershipTransferred(address(0), owner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Publish a new version of a jurisdiction's rules.
    function publish(
        bytes3 code,
        uint8 selfEraseAge,
        uint32 maxRetentionDays,
        bool profilingAllowed,
        string calldata statuteCite
    ) external onlyOwner returns (uint96 version) {
        if (selfEraseAge == 0 || bytes(statuteCite).length == 0) revert BadCode();
        version = versionOf[code] + 1;
        _versions[code][version] = PolicyVersion(selfEraseAge, maxRetentionDays, profilingAllowed, statuteCite, uint64(block.timestamp), true);
        versionOf[code] = version;
        totalVersionCount++;
        policyCount[code] = uint32(policyCount[code]) + 1;
        emit PolicyPublished(code, version, statuteCite, uint64(block.timestamp));
    }

    function deactivate(bytes3 code, uint96 version) external onlyOwner {
        _versions[code][version].active = false;
        emit PolicyDeactivated(code, version);
    }

    function versionAt(bytes3 code, uint96 version) external view returns (PolicyVersion memory) {
        return _versions[code][version];
    }

    function activeVersion(bytes3 code) external view returns (uint96 version, PolicyVersion memory pv) {
        version = versionOf[code];
        if (version == 0 || !_versions[code][version].active) revert NotActive(code);
        pv = _versions[code][version];
    }

    function isActive(bytes3 code) external view returns (bool) {
        return versionOf[code] != 0 && _versions[code][versionOf[code]].active;
    }
}
