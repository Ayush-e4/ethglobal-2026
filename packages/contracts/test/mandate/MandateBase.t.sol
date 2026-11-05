// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MandateRegistry} from "../../src/MandateRegistry.sol";
import {IMandateRegistry} from "../../src/mandate/IMandateRegistry.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @dev Shared setup: an owner with 1000 USDC who approved the registry, a trip agent, a
///   flights agent and two merchants. Helpers build, sign and submit payments.
abstract contract MandateBase is Test {
    MandateRegistry registry;
    MockUSDC usdc;

    address owner = makeAddr("owner");
    uint256 tripKey = 0xA11CE;
    uint256 flightsKey = 0xB0B;
    address tripAgent;
    address flightsAgent;
    address airline = makeAddr("airline");
    address hotel = makeAddr("hotel");
    address stranger = makeAddr("stranger");

    uint128 constant BUDGET = 40e6; // 40 USDC
    uint128 constant CAP = 15e6; // 15 USDC per payment
    uint32 constant UNDO = 60; // a minute to change your mind
    uint32 constant REVIEW = 1 hours;

    function setUp() public virtual {
        registry = new MandateRegistry();
        usdc = new MockUSDC();
        tripAgent = vm.addr(tripKey);
        flightsAgent = vm.addr(flightsKey);
        usdc.mint(owner, 1000e6);
        vm.prank(owner);
        usdc.approve(address(registry), type(uint256).max);
    }

    function _payees(address a, address b) internal pure returns (address[] memory p) {
        p = new address[](2);
        p[0] = a;
        p[1] = b;
    }

    function _params(address[] memory payees)
        internal
        view
        returns (IMandateRegistry.MandateParams memory)
    {
        return IMandateRegistry.MandateParams({
            agent: tripAgent,
            token: address(usdc),
            budget: BUDGET,
            perPaymentCap: CAP,
            expiresAt: uint64(block.timestamp + 1 days),
            payees: payees
        });
    }

    /// Root mandate: the trip agent, 40 USDC, 15 per payment, airline and hotel only.
    function _createRoot() internal returns (uint256 id) {
        vm.prank(owner);
        id = registry.createMandate(_params(_payees(airline, hotel)));
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _auth(uint256 id, address payTo, uint256 amount, uint256 nonce)
        internal
        view
        returns (IMandateRegistry.PaymentAuth memory)
    {
        return IMandateRegistry.PaymentAuth(id, payTo, amount, nonce, block.timestamp + 5 minutes);
    }

    /// Signs a direct payment as `key` and submits it.
    function _pay(uint256 key, uint256 id, address payTo, uint256 amount, uint256 nonce) internal {
        IMandateRegistry.PaymentAuth memory a = _auth(id, payTo, amount, nonce);
        registry.pay(a, _sign(key, registry.paymentDigest(a)));
    }

    /// Signs first, then expects the payment itself to fail with `err`.
    function _payReverts(
        uint256 key,
        uint256 id,
        address payTo,
        uint256 amount,
        uint256 nonce,
        bytes4 err
    ) internal {
        IMandateRegistry.PaymentAuth memory a = _auth(id, payTo, amount, nonce);
        bytes memory sig = _sign(key, registry.paymentDigest(a));
        vm.expectRevert(err);
        registry.pay(a, sig);
    }

    function _escrowAuth(uint256 id, address payTo, uint256 amount, uint256 nonce)
        internal
        view
        returns (IMandateRegistry.EscrowAuth memory)
    {
        return IMandateRegistry.EscrowAuth({
            mandateId: id,
            payTo: payTo,
            amount: amount,
            nonce: nonce,
            validBefore: block.timestamp + 5 minutes,
            undoSeconds: UNDO,
            deliverBy: uint64(block.timestamp + 1 days),
            reviewSeconds: REVIEW
        });
    }

    /// The trip agent pays `amount` into escrow for `payTo`. Returns the escrow id.
    function _hold(uint256 id, address payTo, uint256 amount, uint256 nonce)
        internal
        returns (bytes32)
    {
        IMandateRegistry.EscrowAuth memory a = _escrowAuth(id, payTo, amount, nonce);
        return registry.payIntoEscrow(a, _sign(tripKey, registry.escrowDigest(a)));
    }

    function _subAuth(uint256 parentId, uint128 budget, address[] memory payees, uint256 nonce)
        internal
        view
        returns (IMandateRegistry.SubMandateAuth memory)
    {
        return IMandateRegistry.SubMandateAuth({
            parentId: parentId,
            agent: flightsAgent,
            budget: budget,
            perPaymentCap: budget < CAP ? budget : CAP,
            expiresAt: uint64(block.timestamp + 12 hours),
            payeesHash: keccak256(abi.encodePacked(payees)),
            nonce: nonce,
            validBefore: block.timestamp + 5 minutes
        });
    }

    /// The trip agent hands `budget` to the flights agent, airline only.
    function _createSub(uint256 parentId, uint128 budget) internal returns (uint256 id) {
        address[] memory payees = new address[](1);
        payees[0] = airline;
        IMandateRegistry.SubMandateAuth memory a = _subAuth(parentId, budget, payees, 1000);
        id = registry.createSubMandate(a, payees, _sign(tripKey, registry.subMandateDigest(a)));
    }

    function _state(bytes32 id) internal view returns (IMandateRegistry.EscrowState) {
        return registry.getEscrow(id).state;
    }
}
