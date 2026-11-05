// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MandateRegistry} from "../../src/MandateRegistry.sol";
import {IMandateRegistry} from "../../src/mandate/IMandateRegistry.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @dev Random payments, holds, cancels, deliveries, releases, claims, disputes, refunds,
///   reclaims and time jumps against one mandate. Ghost totals track where money should be.
contract Handler is Test {
    MandateRegistry public registry;
    MockUSDC public usdc;
    address public owner;
    uint256 public agentKey;
    uint256 public id;
    address[2] public payees;

    bytes32[] public escrows;
    uint256 public paidOut; // reached a payee, directly or from escrow
    uint256 public held; // sitting in open escrows
    uint256 nonce;

    constructor(MandateRegistry r, MockUSDC u, address o, uint256 key, uint256 mandateId) {
        (registry, usdc, owner, agentKey, id) = (r, u, o, key, mandateId);
        payees = [makeAddr("airline"), makeAddr("hotel")];
    }

    function _sign(bytes32 digest) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(agentKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function pay(uint256 amount, uint256 who) external {
        amount = bound(amount, 1, 20e6);
        IMandateRegistry.PaymentAuth memory a = IMandateRegistry.PaymentAuth(
            id, payees[who % 2], amount, ++nonce, block.timestamp + 5 minutes
        );
        registry.pay(a, _sign(registry.paymentDigest(a)));
        paidOut += amount;
    }

    function hold(uint256 amount, uint256 who, uint32 undo) external {
        amount = bound(amount, 1, 20e6);
        undo = uint32(bound(undo, 0, 2 hours));
        IMandateRegistry.EscrowAuth memory a = IMandateRegistry.EscrowAuth({
            mandateId: id,
            payTo: payees[who % 2],
            amount: amount,
            nonce: ++nonce,
            validBefore: block.timestamp + 5 minutes,
            undoSeconds: undo,
            deliverBy: uint64(block.timestamp + undo + 1 days),
            reviewSeconds: 1 hours
        });
        escrows.push(registry.payIntoEscrow(a, _sign(registry.escrowDigest(a))));
        held += amount;
    }

    function _pick(uint256 i) internal view returns (bytes32 e, IMandateRegistry.Escrow memory x) {
        e = escrows[i % escrows.length];
        x = registry.getEscrow(e);
    }

    function cancel(uint256 i) external {
        if (escrows.length == 0) return;
        (bytes32 e, IMandateRegistry.Escrow memory x) = _pick(i);
        vm.prank(i % 2 == 0 ? owner : vm.addr(agentKey));
        registry.cancel(e);
        held -= x.amount;
    }

    function deliver(uint256 i) external {
        if (escrows.length == 0) return;
        (bytes32 e, IMandateRegistry.Escrow memory x) = _pick(i);
        vm.prank(x.payee);
        registry.markDelivered(e, bytes32(i));
    }

    function release(uint256 i) external {
        if (escrows.length == 0) return;
        (bytes32 e, IMandateRegistry.Escrow memory x) = _pick(i);
        vm.prank(owner);
        registry.release(e);
        held -= x.amount;
        paidOut += x.amount;
    }

    function claim(uint256 i) external {
        if (escrows.length == 0) return;
        (bytes32 e, IMandateRegistry.Escrow memory x) = _pick(i);
        registry.claim(e);
        held -= x.amount;
        paidOut += x.amount;
    }

    function dispute(uint256 i) external {
        if (escrows.length == 0) return;
        (bytes32 e,) = _pick(i);
        vm.prank(owner);
        registry.dispute(e);
    }

    function refund(uint256 i) external {
        if (escrows.length == 0) return;
        (bytes32 e, IMandateRegistry.Escrow memory x) = _pick(i);
        vm.prank(x.payee);
        registry.refund(e);
        held -= x.amount;
    }

    function reclaim(uint256 i) external {
        if (escrows.length == 0) return;
        (bytes32 e, IMandateRegistry.Escrow memory x) = _pick(i);
        registry.reclaim(e);
        held -= x.amount;
    }

    function wait(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 6 hours));
    }
}

contract InvariantTest is Test {
    MandateRegistry registry;
    MockUSDC usdc;
    Handler handler;
    address owner = makeAddr("owner");
    uint256 constant START = 1000e6;

    function setUp() public {
        registry = new MandateRegistry();
        usdc = new MockUSDC();
        usdc.mint(owner, START);
        uint256 agentKey = 0xA11CE;
        vm.startPrank(owner);
        usdc.approve(address(registry), type(uint256).max);
        uint256 id = registry.createMandate(
            IMandateRegistry.MandateParams({
                agent: vm.addr(agentKey),
                token: address(usdc),
                budget: 200e6,
                perPaymentCap: 15e6,
                expiresAt: uint64(block.timestamp + 30 days),
                payees: new address[](0)
            })
        );
        vm.stopPrank();
        handler = new Handler(registry, usdc, owner, agentKey, id);
        targetContract(address(handler));
    }

    /// The registry holds exactly what's in open escrows: nothing else, nothing stuck.
    function invariant_registryHoldsExactlyTheOpenEscrows() public view {
        assertEq(usdc.balanceOf(address(registry)), handler.held());
    }

    /// The owner lost exactly what reached payees plus what's still held.
    function invariant_ownerLosesOnlyWhatWasPaidOrHeld() public view {
        assertEq(START - usdc.balanceOf(owner), handler.paidOut() + handler.held());
    }

    /// Spending never exceeds the budget, and the budget counts held money too.
    function invariant_neverOverBudget() public view {
        IMandateRegistry.Mandate memory m = registry.getMandate(handler.id());
        assertLe(uint256(m.spent) + m.delegated, m.budget);
        assertEq(m.spent, handler.paidOut() + handler.held());
    }
}
