// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IMandateRegistry} from "../../src/mandate/IMandateRegistry.sol";
import {MandateBase} from "./MandateBase.t.sol";

/// @dev An agent hires another agent with a slice of its own limit.
contract SubMandateTest is MandateBase {
    uint256 root;

    function setUp() public override {
        super.setUp();
        root = _createRoot();
    }

    function test_parentHandsOnASliceOfItsBudget() public {
        uint256 sub = _createSub(root, 20e6);
        IMandateRegistry.Mandate memory m = registry.getMandate(sub);
        assertEq(m.owner, owner, "same owner as the parent");
        assertEq(m.agent, flightsAgent);
        assertEq(m.parentId, root);
        assertEq(m.depth, 1);
        assertEq(registry.remaining(root), 20e6, "carved out of the parent");

        _pay(flightsKey, sub, airline, 10e6, 1);
        assertEq(usdc.balanceOf(airline), 10e6);
        assertEq(registry.remaining(sub), 10e6);
    }

    function test_cantHandOnMoreThanIsLeft() public {
        _pay(tripKey, root, hotel, 15e6, 1);
        address[] memory payees = new address[](1);
        payees[0] = airline;
        IMandateRegistry.SubMandateAuth memory a = _subAuth(root, 26e6, payees, 2);
        bytes memory sig = _sign(tripKey, registry.subMandateDigest(a));
        vm.expectRevert(IMandateRegistry.OverBudget.selector);
        registry.createSubMandate(a, payees, sig);
    }

    function test_limitsOnlyGetTighter() public {
        address[] memory payees = new address[](1);
        payees[0] = airline;
        IMandateRegistry.SubMandateAuth memory a = _subAuth(root, 20e6, payees, 1);
        a.expiresAt = uint64(block.timestamp + 2 days); // outlives the parent
        bytes memory sig = _sign(tripKey, registry.subMandateDigest(a));
        vm.expectRevert(IMandateRegistry.InvalidParams.selector);
        registry.createSubMandate(a, payees, sig);
    }

    function test_onlyThePayeesTheParentAllows() public {
        address[] memory payees = new address[](1);
        payees[0] = stranger;
        IMandateRegistry.SubMandateAuth memory a = _subAuth(root, 5e6, payees, 1);
        bytes memory sig = _sign(tripKey, registry.subMandateDigest(a));
        vm.expectRevert(IMandateRegistry.PayeeNotAllowed.selector);
        registry.createSubMandate(a, payees, sig);
    }

    function test_onlyTheParentsAgentCanSign() public {
        address[] memory payees = new address[](1);
        payees[0] = airline;
        IMandateRegistry.SubMandateAuth memory a = _subAuth(root, 5e6, payees, 1);
        bytes memory sig = _sign(flightsKey, registry.subMandateDigest(a));
        vm.expectRevert(IMandateRegistry.BadSignature.selector);
        registry.createSubMandate(a, payees, sig);
    }

    function test_payeesMustMatchWhatWasSigned() public {
        address[] memory payees = new address[](1);
        payees[0] = airline;
        IMandateRegistry.SubMandateAuth memory a = _subAuth(root, 5e6, payees, 1);
        bytes memory sig = _sign(tripKey, registry.subMandateDigest(a));
        payees[0] = hotel;
        vm.expectRevert(IMandateRegistry.InvalidParams.selector);
        registry.createSubMandate(a, payees, sig);
    }

    function test_revokingTheParentStopsTheChild() public {
        uint256 sub = _createSub(root, 20e6);
        vm.prank(owner);
        registry.revoke(root);
        assertFalse(registry.isActive(sub));
        _payReverts(flightsKey, sub, airline, 1e6, 1, IMandateRegistry.MandateInactive.selector);
    }
}
