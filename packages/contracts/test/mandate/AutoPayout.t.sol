// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IMandateRegistry} from "../../src/mandate/IMandateRegistry.sol";
import {MockScheduleService} from "../mocks/MockScheduleService.sol";
import {MandateBase} from "./MandateBase.t.sol";

/// @dev On delivery the registry asks Hedera (HIP-1215) to call `claim` when the review ends.
contract AutoPayoutTest is MandateBase {
    address constant HSS = address(0x16b);
    MockScheduleService hss = MockScheduleService(HSS);
    uint256 id;
    bytes32 e;

    function setUp() public override {
        super.setUp();
        vm.etch(HSS, address(new MockScheduleService()).code);
        id = _createRoot();
        e = _hold(id, hotel, 10e6, 1);
        vm.warp(block.timestamp + UNDO);
    }

    function _deliver() internal {
        vm.prank(hotel);
        registry.markDelivered(e, keccak256("booking"));
    }

    function test_deliveryAsksHederaToPayOutWhenTheReviewEnds() public {
        uint256 at = block.timestamp + REVIEW + registry.PAYOUT_DELAY();
        vm.expectEmit(true, false, false, true);
        emit IMandateRegistry.PayoutScheduled(e, address(0x5c4ed), at);
        _deliver();
        assertEq(hss.lastTo(), address(registry));
        assertEq(hss.lastAt(), at);
        assertEq(hss.lastGas(), registry.PAYOUT_GAS());
        assertEq(hss.lastData(), abi.encodeCall(registry.claim, (e)));

        // When the time comes, the network runs the scheduled call (its clock may lag 2 s).
        vm.warp(at - 2);
        (bool ok,) = address(registry).call(hss.lastData());
        assertTrue(ok);
        assertEq(usdc.balanceOf(hotel), 10e6);
    }

    function test_skipsASecondWithNoRoom() public {
        uint256 at = block.timestamp + REVIEW + registry.PAYOUT_DELAY();
        hss.setBusy(at);
        _deliver();
        assertEq(hss.lastAt(), at + 1);
    }

    function test_aDisputedPaymentIsNotPaidByTheSchedule() public {
        _deliver();
        vm.prank(owner);
        registry.dispute(e);
        vm.warp(hss.lastAt());
        (bool ok,) = address(registry).call(hss.lastData());
        assertFalse(ok, "claim refuses a disputed payment");
        assertEq(usdc.balanceOf(hotel), 0);
    }

    function test_withoutTheServiceDeliveryStillWorks() public {
        vm.etch(HSS, "");
        vm.expectEmit(true, false, false, true);
        emit IMandateRegistry.PayoutNotScheduled(e, -1);
        _deliver();
        vm.warp(block.timestamp + REVIEW);
        registry.claim(e);
        assertEq(usdc.balanceOf(hotel), 10e6);
    }

    function test_anyoneCanTopUpHbarForFees() public {
        vm.deal(stranger, 5 ether);
        vm.prank(stranger);
        (bool ok,) = address(registry).call{value: 5 ether}("");
        assertTrue(ok);
        assertEq(address(registry).balance, 5 ether);
    }
}
