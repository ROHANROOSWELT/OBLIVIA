// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {EraseRegistry} from "../src/EraseRegistry.sol";

/**
 * @dev Deploys + seeds the rule tables, then the registry.
 *
 *   forge script script/Deploy.s.sol --rpc-url <RPC> --broadcast
 *
 * Env: PRIVATE_KEY (required; defaults to a known anvil key for local dev),
 * FORWARDER (optional; Base Sepolia production KeystoneForwarder =
 * 0xF8344CFd5c43616a4366C34E3EEE75af79a74482), ATTESTOR_ADDRESS (optional;
 * defaults to the deployer — matches the hub when one key does both).
 */
contract Deploy is Script {
    uint256 constant ANVIL_DEFAULT_PK =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function run() external {
        uint256 pk = vm.envOr("PRIVATE_KEY", ANVIL_DEFAULT_PK);
        vm.startBroadcast(pk);

        PolicyRegistry policy = new PolicyRegistry(msg.sender);

        // Seed jurisdiction rule tables (the Policy Warden).
        // codes: CPP=US-COPPA, MDP=US-Maryland(MODPA), EUR=EU(GDPR), IND=India(DPDP)
        bytes3 code_coppa = 0x435050; // "CPP"
        bytes3 code_modpa = 0x4D4450; // "MDP"
        bytes3 code_gdpr = 0x455552; // "EUR"
        bytes3 code_dpdp = 0x494E44; // "IND"
        policy.publish(code_coppa, 13, 30, false, unicode"COPPA, 15 U.S.C. secs 6501-6505; 16 CFR Part 312 (2025 amendments)");
        policy.publish(code_modpa, 18, 60, false, unicode"Maryland Online Data Privacy Act (MODPA), eff. Oct 1 2025");
        policy.publish(code_gdpr, 16, 30, false, unicode"GDPR Art. 8, 17 & Recital 26 (13-16 by Member State)");
        policy.publish(code_dpdp, 18, 30, false, unicode"India DPDP Act 2023 secs 9 & 12 + DPDP Rules");

        address attestor = vm.envOr("ATTESTOR_ADDRESS", address(0));
        if (attestor == address(0)) attestor = msg.sender;
        address forwarder = vm.envOr("FORWARDER", address(0));

        EraseRegistry registry = new EraseRegistry(address(policy), forwarder, attestor);

        vm.stopBroadcast();

        console2.log("PolicyRegistry:", address(policy));
        console2.log("EraseRegistry :", address(registry));
        console2.log("Attestor      :", attestor);
        console2.log("Forwarder     :", forwarder);

        string memory json = string.concat(
            '{"chainId":',
            vm.toString(block.chainid),
            ',"PolicyRegistry":"',
            vm.toString(address(policy)),
            '","EraseRegistry":"',
            vm.toString(address(registry)),
            '","Attestor":"',
            vm.toString(attestor),
            '","Forwarder":"',
            vm.toString(forwarder),
            '","blockNumber":',
            vm.toString(block.number),
            ',"deployedAt":',
            vm.toString(block.timestamp),
            "}"
        );
        vm.writeFile("../hub/deployments.json", json);
        console2.log("Wrote ../hub/deployments.json");
    }
}
