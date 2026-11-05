// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IMandateRegistry} from "../../src/mandate/IMandateRegistry.sol";
import {MandateRegistry} from "../../src/MandateRegistry.sol";
import {MandateBase} from "./MandateBase.t.sol";

/// @dev The x402 Hedera transferExecutor entry points a facilitator calls.
contract X402Test is MandateBase {
    uint256 id;

    function setUp() public override {
        super.setUp();
        id = _createRoot();
    }

    function test_selectorMatchesTheX402Spec() public pure {
        assertEq(MandateRegistry.executeTransfer.selector, bytes4(0xea8f19fd));
    }

    function test_executeTransferPaysDirectly() public {
        IMandateRegistry.PaymentAuth memory a = _auth(id, airline, 3e6, 7);
        bytes memory sig = _sign(tripKey, registry.paymentDigest(a));
        registry.executeTransfer(
            owner, address(usdc), airline, 3e6, abi.encode(id, 7, a.validBefore, sig)
        );
        assertEq(usdc.balanceOf(airline), 3e6);
    }

    function test_executeEscrowTransferHolds() public {
        IMandateRegistry.EscrowAuth memory a = _escrowAuth(id, hotel, 4e6, 8);
        bytes memory sig = _sign(tripKey, registry.escrowDigest(a));
        IMandateRegistry.EscrowTerms memory t = IMandateRegistry.EscrowTerms(
            id, 8, a.validBefore, a.undoSeconds, a.deliverBy, a.reviewSeconds
        );
        bytes32 e =
            registry.executeEscrowTransfer(owner, address(usdc), hotel, 4e6, abi.encode(t, sig));
        assertEq(e, registry.escrowIdOf(id, 8));
        assertEq(usdc.balanceOf(address(registry)), 4e6);
    }

    function test_fromAndAssetMustMatchTheMandate() public {
        IMandateRegistry.PaymentAuth memory a = _auth(id, airline, 3e6, 7);
        bytes memory auth =
            abi.encode(id, 7, a.validBefore, _sign(tripKey, registry.paymentDigest(a)));
        vm.expectRevert(IMandateRegistry.WrongOwnerOrAsset.selector);
        registry.executeTransfer(stranger, address(usdc), airline, 3e6, auth);
        vm.expectRevert(IMandateRegistry.WrongOwnerOrAsset.selector);
        registry.executeTransfer(owner, address(0xdead), airline, 3e6, auth);
    }

    function test_amountIsBoundToTheSignature() public {
        IMandateRegistry.PaymentAuth memory a = _auth(id, airline, 3e6, 7);
        bytes memory sig = _sign(tripKey, registry.paymentDigest(a));
        vm.expectRevert(IMandateRegistry.BadSignature.selector);
        registry.executeTransfer(
            owner, address(usdc), airline, 9e6, abi.encode(id, 7, a.validBefore, sig)
        );
    }
}
