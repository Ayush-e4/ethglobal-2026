// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IMandateRegistry} from "../../src/mandate/IMandateRegistry.sol";
import {MandateBase} from "./MandateBase.t.sol";

contract CreateTest is MandateBase {
    function test_ownerCreatesAMandate() public {
        uint256 id = _createRoot();
        IMandateRegistry.Mandate memory m = registry.getMandate(id);
        assertEq(id, 1);
        assertEq(m.owner, owner);
        assertEq(m.agent, tripAgent);
        assertEq(m.budget, BUDGET);
        assertEq(m.perPaymentCap, CAP);
        assertTrue(m.restrictPayees);
        assertTrue(registry.isPayeeAllowed(id, airline));
        assertFalse(registry.isPayeeAllowed(id, stranger));
        assertEq(registry.remaining(id), BUDGET);
        assertTrue(registry.isActive(id));
        assertEq(usdc.balanceOf(address(registry)), 0, "funds stay with the owner");
    }

    function test_emptyPayeesMeansAnyone() public {
        vm.prank(owner);
        uint256 id = registry.createMandate(_params(new address[](0)));
        _pay(tripKey, id, stranger, 1e6, 1);
        assertEq(usdc.balanceOf(stranger), 1e6);
    }

    function test_rejectsBadParams() public {
        IMandateRegistry.MandateParams memory p = _params(new address[](0));
        p.agent = address(0);
        _expectInvalid(p);
        p = _params(new address[](0));
        p.budget = 0;
        _expectInvalid(p);
        p = _params(new address[](0));
        p.perPaymentCap = BUDGET + 1;
        _expectInvalid(p);
        p = _params(new address[](0));
        p.expiresAt = uint64(block.timestamp);
        _expectInvalid(p);
        p = _params(_payees(airline, address(0)));
        _expectInvalid(p);
    }

    function _expectInvalid(IMandateRegistry.MandateParams memory p) internal {
        vm.prank(owner);
        vm.expectRevert(IMandateRegistry.InvalidParams.selector);
        registry.createMandate(p);
    }
}
