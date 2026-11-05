// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IMandateRegistry} from "../../src/mandate/IMandateRegistry.sol";
import {MandateBase} from "./MandateBase.t.sol";

/// @dev The undo window: the owner or the agent can cancel, the payee can't start, and nobody
///   else (our servers included) can do either.
contract UndoTest is MandateBase {
    uint256 id;
    bytes32 e;

    function setUp() public override {
        super.setUp();
        id = _createRoot();
        e = _hold(id, hotel, 10e6, 1);
    }

    function test_ownerCancelsWithinTheWindow() public {
        vm.warp(block.timestamp + UNDO - 1);
        vm.expectEmit(true, true, false, false);
        emit IMandateRegistry.EscrowCancelled(e, owner);
        vm.prank(owner);
        registry.cancel(e);
        assertEq(usdc.balanceOf(owner), 1000e6, "nothing paid");
        assertEq(usdc.balanceOf(hotel), 0);
        assertEq(registry.remaining(id), BUDGET, "budget back");
        assertEq(uint8(_state(e)), uint8(IMandateRegistry.EscrowState.Refunded));
    }

    function test_theAgentCanUndoItsOwnPayment() public {
        vm.prank(tripAgent);
        registry.cancel(e);
        assertEq(usdc.balanceOf(owner), 1000e6);
    }

    function test_nobodyElseCanCancel() public {
        address[3] memory others = [stranger, hotel, flightsAgent];
        for (uint256 i; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(IMandateRegistry.NotAuthorized.selector);
            registry.cancel(e);
        }
    }

    function test_tooLateOnceTheWindowEnds() public {
        vm.warp(block.timestamp + UNDO);
        vm.prank(owner);
        vm.expectRevert(IMandateRegistry.TooLate.selector);
        registry.cancel(e);
    }

    function test_thePayeeCantDeliverDuringTheWindow() public {
        vm.prank(hotel);
        vm.expectRevert(IMandateRegistry.TooEarly.selector);
        registry.markDelivered(e, bytes32(0));
        vm.warp(block.timestamp + UNDO);
        vm.prank(hotel);
        registry.markDelivered(e, bytes32(0));
    }

    function test_cantCancelTwice() public {
        vm.prank(owner);
        registry.cancel(e);
        vm.prank(owner);
        vm.expectRevert(IMandateRegistry.WrongEscrowState.selector);
        registry.cancel(e);
    }

    function test_theWindowIsPartOfWhatTheAgentSigned() public {
        IMandateRegistry.EscrowAuth memory a = _escrowAuth(id, hotel, 1e6, 2);
        bytes memory sig = _sign(tripKey, registry.escrowDigest(a));
        a.undoSeconds = 0; // someone tries to skip the window
        vm.expectRevert(IMandateRegistry.BadSignature.selector);
        registry.payIntoEscrow(a, sig);
    }

    function test_deliveryDeadlineMustBeAfterTheWindow() public {
        IMandateRegistry.EscrowAuth memory a = _escrowAuth(id, hotel, 1e6, 2);
        a.deliverBy = uint64(block.timestamp + UNDO);
        bytes memory sig = _sign(tripKey, registry.escrowDigest(a));
        vm.expectRevert(IMandateRegistry.InvalidParams.selector);
        registry.payIntoEscrow(a, sig);
    }

    function test_windowCanLastOvernightButNotForever() public {
        IMandateRegistry.EscrowAuth memory a = _escrowAuth(id, hotel, 1e6, 2);
        a.undoSeconds = 8 hours;
        a.deliverBy = uint64(block.timestamp + 1 days);
        registry.payIntoEscrow(a, _sign(tripKey, registry.escrowDigest(a)));

        a = _escrowAuth(id, hotel, 1e6, 3);
        a.undoSeconds = registry.MAX_UNDO() + 1;
        a.deliverBy = uint64(block.timestamp + 30 days);
        bytes memory sig = _sign(tripKey, registry.escrowDigest(a));
        vm.expectRevert(IMandateRegistry.InvalidParams.selector);
        registry.payIntoEscrow(a, sig);
    }

    function test_noWindowWhenTheAgentSignsZero() public {
        IMandateRegistry.EscrowAuth memory a = _escrowAuth(id, hotel, 1e6, 2);
        a.undoSeconds = 0;
        bytes32 x = registry.payIntoEscrow(a, _sign(tripKey, registry.escrowDigest(a)));
        vm.prank(hotel);
        registry.markDelivered(x, bytes32(0));
        vm.prank(owner);
        vm.expectRevert(IMandateRegistry.WrongEscrowState.selector);
        registry.cancel(x);
    }
}
