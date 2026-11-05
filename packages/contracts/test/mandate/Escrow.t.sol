// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IMandateRegistry} from "../../src/mandate/IMandateRegistry.sol";
import {MandateBase} from "./MandateBase.t.sol";

/// @dev Pay on delivery after the undo window: deliver, then release, claim, dispute or refund.
contract EscrowTest is MandateBase {
    uint256 id;
    bytes32 e;

    function setUp() public override {
        super.setUp();
        id = _createRoot();
        e = _hold(id, hotel, 10e6, 1);
    }

    function _deliver() internal {
        vm.warp(block.timestamp + UNDO);
        vm.prank(hotel);
        registry.markDelivered(e, keccak256("booking HTL-123"));
    }

    function test_heldInTheRegistryNotPaid() public {
        IMandateRegistry.Escrow memory x = registry.getEscrow(e);
        assertEq(e, registry.escrowIdOf(id, 1));
        assertEq(uint8(x.state), uint8(IMandateRegistry.EscrowState.Held));
        assertEq(x.startsAt, block.timestamp + UNDO);
        assertEq(usdc.balanceOf(address(registry)), 10e6);
        assertEq(usdc.balanceOf(hotel), 0);
        assertEq(registry.remaining(id), 30e6, "held money counts against the budget");
    }

    function test_deliverThenBuyerReleases() public {
        _deliver();
        assertEq(registry.getEscrow(e).resultHash, keccak256("booking HTL-123"));
        vm.prank(tripAgent);
        registry.release(e);
        assertEq(usdc.balanceOf(hotel), 10e6);
        assertEq(usdc.balanceOf(address(registry)), 0);
        assertEq(uint8(_state(e)), uint8(IMandateRegistry.EscrowState.Released));
    }

    function test_afterTheReviewAnyoneCanPayItOut() public {
        _deliver();
        vm.expectRevert(IMandateRegistry.TooEarly.selector);
        registry.claim(e);
        vm.warp(block.timestamp + REVIEW);
        vm.prank(stranger); // e.g. a Hedera scheduled transaction
        registry.claim(e);
        assertEq(usdc.balanceOf(hotel), 10e6);
    }

    function test_disputeFreezesItUntilThePayeeRefunds() public {
        _deliver();
        vm.prank(owner);
        registry.dispute(e);
        vm.warp(block.timestamp + REVIEW);
        vm.expectRevert(IMandateRegistry.WrongEscrowState.selector);
        registry.claim(e);
        vm.prank(hotel);
        registry.refund(e);
        assertEq(usdc.balanceOf(owner), 1000e6);
        assertEq(registry.remaining(id), BUDGET, "a refund gives the budget back");
    }

    function test_disputeOnlyWithinTheReview() public {
        _deliver();
        vm.warp(block.timestamp + REVIEW);
        vm.prank(owner);
        vm.expectRevert(IMandateRegistry.TooLate.selector);
        registry.dispute(e);
    }

    function test_neverDeliveredGoesBack() public {
        vm.expectRevert(IMandateRegistry.TooEarly.selector);
        registry.reclaim(e);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(hotel);
        vm.expectRevert(IMandateRegistry.TooLate.selector);
        registry.markDelivered(e, bytes32(0));
        registry.reclaim(e);
        assertEq(usdc.balanceOf(owner), 1000e6);
        assertEq(uint8(_state(e)), uint8(IMandateRegistry.EscrowState.Refunded));
    }

    function test_onlyThePayeeDeliversOrRefunds() public {
        vm.warp(block.timestamp + UNDO);
        vm.startPrank(stranger);
        vm.expectRevert(IMandateRegistry.NotAuthorized.selector);
        registry.markDelivered(e, bytes32(0));
        vm.expectRevert(IMandateRegistry.NotAuthorized.selector);
        registry.refund(e);
        vm.expectRevert(IMandateRegistry.NotAuthorized.selector);
        registry.release(e);
        vm.stopPrank();
    }

    function test_paidOutOnlyOnce() public {
        _deliver();
        vm.prank(tripAgent);
        registry.release(e);
        vm.prank(hotel);
        vm.expectRevert(IMandateRegistry.WrongEscrowState.selector);
        registry.refund(e);
    }

    function test_heldMoneyFollowsTheEscrowEvenIfTheLimitIsRevoked() public {
        vm.prank(owner);
        registry.revoke(id);
        _deliver();
        vm.prank(owner);
        registry.release(e);
        assertEq(usdc.balanceOf(hotel), 10e6);
    }

    function test_unknownEscrow() public {
        vm.expectRevert(IMandateRegistry.UnknownEscrow.selector);
        registry.claim(bytes32(uint256(1)));
    }
}
