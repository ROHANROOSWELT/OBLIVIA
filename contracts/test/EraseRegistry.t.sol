// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {EraseRegistry} from "../src/EraseRegistry.sol";

contract EraseRegistryTest is Test {
    PolicyRegistry policy;
    EraseRegistry registry;

    uint256 constant ATTESTOR_PK = 0x1234_5678_90ab;
    address attestor;
    address guardian;
    address principal;

    bytes32 SUBJECT;
    bytes32 constant SCOPE_A = keccak256("scope-a");
    bytes32 constant SCOPE_B = keccak256("scope-b");
    bytes32 constant DEC_A = keccak256("DEC-json-A");
    bytes32 constant DEC_FULL = keccak256("DEC-json-FULL");
    bytes32 constant DEC_B = keccak256("DEC-json-B");
    bytes32 constant AGE_HASH = keccak256("guardian-age-declaration");
    bytes32 constant ROOT = keccak256("data-root");
    bytes32 constant METHOD = keccak256("SALT_SHRED@v1");
    bytes3 constant CPP = 0x435050; // "CPP"
    bytes3 constant UNKNOWN = 0x5A5A5A; // "ZZZ"

    function setUp() public {
        policy = new PolicyRegistry(address(this));
        policy.publish(CPP, 13, 30, false, "COPPA test");
        attestor = vm.addr(ATTESTOR_PK);
        guardian = makeAddr("guardian");
        principal = makeAddr("principal");
        registry = new EraseRegistry(address(policy), address(0), attestor);
        SUBJECT = keccak256("subject-1");
    }

    /* ------------------------------------------------------------- policy */
    function test_policyActive() public view {
        (uint96 v, PolicyRegistry.PolicyVersion memory pv) = policy.activeVersion(CPP);
        assertEq(v, 1);
        assertEq(pv.selfEraseAge, 13);
        assertTrue(policy.isActive(CPP));
        assertFalse(policy.isActive(UNKNOWN));
    }

    /* ------------------------------------------------------- enroll */
    function test_openSubject_binds_live_policy() public {
        vm.prank(guardian);
        registry.openSubject(SUBJECT, CPP, AGE_HASH, ROOT, 365 days, 2);
        (address g, , , uint96 pv, , , , , , , , , ) = registry.subjects(SUBJECT);
        assertEq(g, guardian);
        assertEq(pv, uint96(1));
    }

    function test_openSubject_unknownJurisdiction_reverts() public {
        vm.prank(guardian);
        vm.expectRevert(
            abi.encodeWithSelector(EraseRegistry.PolicyInactive.selector, UNKNOWN)
        );
        registry.openSubject(SUBJECT, UNKNOWN, bytes32(0), bytes32(0), 0, 0);
    }

    function test_openSubject_twice_reverts() public {
        vm.startPrank(guardian);
        registry.openSubject(SUBJECT, CPP, AGE_HASH, ROOT, 365 days, 2);
        vm.expectRevert(abi.encodeWithSelector(EraseRegistry.AlreadyExists.selector, SUBJECT));
        registry.openSubject(SUBJECT, CPP, AGE_HASH, ROOT, 365 days, 2);
        vm.stopPrank();
    }

    function test_openSubject_horizon_reverts() public {
        vm.prank(guardian);
        vm.expectRevert(
            abi.encodeWithSelector(EraseRegistry.BadHorizon.selector, uint64(30 * 365 days))
        );
        registry.openSubject(SUBJECT, CPP, AGE_HASH, ROOT, 30 * 365 days, 2);
    }

    /* ------------------------------------------------------- memory */
    function test_addMemory_rejectedForStranger() public {
        vm.prank(guardian);
        registry.openSubject(SUBJECT, CPP, AGE_HASH, ROOT, 365 days, 2);
        vm.prank(principal);
        vm.expectRevert(EraseRegistry.Unauthorized.selector);
        registry.addMemory(SUBJECT, SCOPE_A, keccak256("m1"));
    }

    function test_addMemory_ghostedAfterScopeErase() public {
        vm.startPrank(guardian);
        registry.openSubject(SUBJECT, CPP, AGE_HASH, ROOT, 365 days, 2);
        registry.addMemory(SUBJECT, SCOPE_A, keccak256("m1"));
        registry.requestErasure(SUBJECT, SCOPE_A);
        vm.stopPrank();

        _notary(_eraseOp(bytes32(0), uint8(EraseRegistry.Reason.REQUEST), SCOPE_A, DEC_A, METHOD));

        assertEq(registry.certificates(keccak256(abi.encode(SUBJECT, SCOPE_A))), DEC_A);
        assertTrue(registry.ghosted(keccak256(abi.encode(SUBJECT, SCOPE_A))));

        vm.prank(guardian);
        vm.expectRevert(
            abi.encodeWithSelector(EraseRegistry.Ghosted.selector, SUBJECT, SCOPE_A)
        );
        registry.addMemory(SUBJECT, SCOPE_A, keccak256("again"));
    }

    /*---------------------------------------------------- full-scope erase */
    function test_fullScope_erase_forgottenForever() public {
        vm.startPrank(guardian);
        registry.openSubject(SUBJECT, CPP, AGE_HASH, ROOT, 365 days, 2);
        registry.addMemory(SUBJECT, SCOPE_A, keccak256("m1"));
        registry.requestErasure(SUBJECT, bytes32(0)); // FULL scope
        vm.stopPrank();

        _notary(_eraseOp(bytes32(0), uint8(EraseRegistry.Reason.REQUEST), bytes32(0), DEC_FULL, METHOD));

        assertTrue(registry.forgotten(SUBJECT));
        (, , , , , , , , , EraseRegistry.Status status, , , ) = registry.subjects(SUBJECT);
        assertEq(uint8(status), uint8(EraseRegistry.Status.ERASED));

        vm.prank(guardian);
        vm.expectRevert(
            abi.encodeWithSelector(EraseRegistry.Ghosted.selector, SUBJECT, SCOPE_B)
        );
        registry.addMemory(SUBJECT, SCOPE_B, keccak256("m2"));
    }

    /*------------------------------------------------------- shouldn't work */
    function test_erase_requires_guardian_request() public {
        vm.prank(guardian);
        registry.openSubject(SUBJECT, CPP, AGE_HASH, ROOT, 365 days, 2);

        vm.expectRevert(
            abi.encodeWithSelector(
                EraseRegistry.NotRequested.selector,
                keccak256(abi.encode(SUBJECT, SCOPE_A))
            )
        );
        _notary(_eraseOp(bytes32(0), uint8(EraseRegistry.Reason.REQUEST), SCOPE_A, DEC_FULL, METHOD));
    }

    function test_notarize_wrongSigner_reverts() public {
        vm.startPrank(guardian);
        registry.openSubject(SUBJECT, CPP, AGE_HASH, ROOT, 365 days, 2);
        registry.requestErasure(SUBJECT, SCOPE_A);
        vm.stopPrank();

        bytes memory payload = abi.encode(_eraseOp(bytes32(0), uint8(EraseRegistry.Reason.REQUEST), SCOPE_A, DEC_FULL, METHOD));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, _digestFor(payload));
        vm.expectRevert(EraseRegistry.BadSig.selector);
        registry.notarize(payload, abi.encodePacked(r, s, v));
    }

    function test_notarize_replay_reverts() public {
        vm.startPrank(guardian);
        registry.openSubject(SUBJECT, CPP, AGE_HASH, ROOT, 365 days, 2);
        registry.requestErasure(SUBJECT, SCOPE_A);
        vm.stopPrank();

        EraseRegistry.Op memory op = _eraseOp(bytes32(0), uint8(EraseRegistry.Reason.REQUEST), SCOPE_A, DEC_FULL, METHOD);
        _notary(op);
        vm.expectRevert(
            abi.encodeWithSelector(
                EraseRegistry.Replay.selector,
                registry.opIdOf(2, SUBJECT, SCOPE_A)
            )
        );
        _notary(op);
    }

    /* ------------------------------------------------------------- vest */
    function test_vest_after_threshold_only() public {
        vm.prank(guardian);
        registry.openSubject(SUBJECT, CPP, AGE_HASH, ROOT, 365 days, 2);

        vm.expectRevert(
            abi.encodeWithSelector(EraseRegistry.NotVestedYet.selector, uint64(365 days), uint64(1))
        );
        _vest();

        (, , , , , , , , bool vestedBefore, , , , ) = registry.subjects(SUBJECT);
        assertFalse(vestedBefore);

        vm.warp(365 days + 1);
        _vest();

        (, address p, , , , , , , bool vested, , , , ) = registry.subjects(SUBJECT);
        assertTrue(vested);
        assertEq(p, principal);

        vm.prank(principal);
        registry.requestErasure(SUBJECT, bytes32(0));
        vm.prank(guardian);
        vm.expectRevert(EraseRegistry.Unauthorized.selector);
        registry.requestErasure(SUBJECT, SCOPE_A);
    }

    /* ------------------------------------------------------------ DON */
    function test_onReport_forwarder_only() public {
        address fwd = makeAddr("keystoneForwarder");
        registry.setForwarder(fwd);

        vm.startPrank(guardian);
        registry.openSubject(SUBJECT, CPP, AGE_HASH, ROOT, 365 days, 2);
        registry.requestErasure(SUBJECT, SCOPE_A);
        vm.stopPrank();

        EraseRegistry.Op memory op = _eraseOp(bytes32(0), uint8(EraseRegistry.Reason.REQUEST), SCOPE_A, DEC_FULL, METHOD);

        vm.expectRevert(EraseRegistry.Unauthorized.selector);
        registry.onReport(new bytes(0), abi.encode(op));

        vm.prank(fwd);
        registry.onReport(new bytes(0), abi.encode(op));
        assertEq(registry.certificates(keccak256(abi.encode(SUBJECT, SCOPE_A))), DEC_FULL);
    }

    /* --------------------------------------------------------- helpers */
    function _eraseOp(
        bytes32 kindPlaceholder,
        uint8 reason,
        bytes32 scopeRef,
        bytes32 decHash,
        bytes32 methodHash
    ) internal view returns (EraseRegistry.Op memory) {
        kindPlaceholder; // silence unused
        return
            EraseRegistry.Op({
                kind: 2,
                reason: reason,
                subjectId: SUBJECT,
                scopeRef: scopeRef,
                hashA: decHash,
                hashB: methodHash,
                account: address(0),
                policyVersion: 0,
                jurisdiction: bytes3(0),
                vestEligibleAt: 0,
                nextBand: 0
            });
    }

    function _notary(EraseRegistry.Op memory op) internal {
        bytes memory payload = abi.encode(op);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ATTESTOR_PK, _digestFor(payload));
        registry.notarize(payload, abi.encodePacked(r, s, v));
    }

    function _vest() internal {
        EraseRegistry.Op memory op = EraseRegistry.Op({
            kind: 3,
            reason: 0,
            subjectId: SUBJECT,
            scopeRef: bytes32(0),
            hashA: bytes32(0),
            hashB: bytes32(0),
            account: principal,
            policyVersion: 0,
            jurisdiction: bytes3(0),
            vestEligibleAt: 0,
            nextBand: 0
        });
        bytes memory payload = abi.encode(op);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ATTESTOR_PK, _digestFor(payload));
        registry.notarize(payload, abi.encodePacked(r, s, v));
    }

    /// @dev replicates exactly what EraseRegistry.notarize does: wrap the raw
    /// digest with EIP-191, then sign. vm.sign signs the digest we hand it, so
    /// the wrap must happen here (ethers signMessage does it on the hub side).
    function _digestFor(bytes memory payload) internal view returns (bytes32) {
        bytes32 raw = keccak256(abi.encode(block.chainid, address(registry), payload));
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", raw));
    }
}
