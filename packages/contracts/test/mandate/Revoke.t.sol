// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IMandateRegistry} from "../../src/mandate/IMandateRegistry.sol";
import {MandateBase} from "./MandateBase.t.sol";

contract RevokeTest is MandateBase {
    uint256 root;
    uint256 sub;

    function setUp() public override {
        super.setUp();
        root = _createRoot();
        sub = _createSub(root, 10e6);
    }

    function test_ownerRevokes() public {
        vm.prank(owner);
        registry.revoke(root);
        _payReverts(tripKey, root, airline, 1e6, 1, IMandateRegistry.MandateInactive.selector);
    }

    function test_theAgentCanStopItself() public {
        vm.prank(tripAgent);
        registry.revoke(root);
        assertFalse(registry.isActive(root));
    }

    function test_theParentsAgentCanStopAChild() public {
        vm.prank(tripAgent);
        registry.revoke(sub);
        assertFalse(registry.isActive(sub));
        assertTrue(registry.isActive(root));
    }

    function test_nobodyElse() public {
        vm.prank(stranger);
        vm.expectRevert(IMandateRegistry.NotAuthorized.selector);
        registry.revoke(root);
        vm.prank(flightsAgent); // a child's agent can't stop its parent
        vm.expectRevert(IMandateRegistry.NotAuthorized.selector);
        registry.revoke(root);
    }

    function test_unknownMandate() public {
        vm.expectRevert(IMandateRegistry.UnknownMandate.selector);
        registry.revoke(99);
    }
}
