// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IMandateRegistry} from "../../src/mandate/IMandateRegistry.sol";
import {MandateBase} from "./MandateBase.t.sol";

contract PayTest is MandateBase {
    uint256 id;

    function setUp() public override {
        super.setUp();
        id = _createRoot();
    }

    function test_agentPaysAnAllowedPayee() public {
        _pay(tripKey, id, airline, 10e6, 1);
        assertEq(usdc.balanceOf(airline), 10e6);
        assertEq(usdc.balanceOf(owner), 990e6);
        assertEq(registry.remaining(id), 30e6);
        assertTrue(registry.nonceUsed(id, 1));
    }

    function test_anyoneMaySubmitTheSignedPayment() public {
        IMandateRegistry.PaymentAuth memory a = _auth(id, hotel, 5e6, 1);
        bytes memory sig = _sign(tripKey, registry.paymentDigest(a));
        vm.prank(stranger);
        registry.pay(a, sig);
        assertEq(usdc.balanceOf(hotel), 5e6);
    }

    function test_overThePerPaymentCap() public {
        _payReverts(tripKey, id, airline, CAP + 1, 1, IMandateRegistry.OverPaymentCap.selector);
    }

    function test_overTheBudget() public {
        _pay(tripKey, id, airline, 15e6, 1);
        _pay(tripKey, id, airline, 15e6, 2);
        _payReverts(tripKey, id, airline, 10e6 + 1, 3, IMandateRegistry.OverBudget.selector);
    }

    function test_payeeNotAllowed() public {
        _payReverts(tripKey, id, stranger, 1e6, 1, IMandateRegistry.PayeeNotAllowed.selector);
    }

    function test_zeroAmount() public {
        _payReverts(tripKey, id, airline, 0, 1, IMandateRegistry.InvalidParams.selector);
    }

    function test_signedBySomeoneElse() public {
        _payReverts(flightsKey, id, airline, 1e6, 1, IMandateRegistry.BadSignature.selector);
    }

    function test_changedAmountBreaksTheSignature() public {
        IMandateRegistry.PaymentAuth memory a = _auth(id, airline, 1e6, 1);
        bytes memory sig = _sign(tripKey, registry.paymentDigest(a));
        a.amount = 10e6;
        vm.expectRevert(IMandateRegistry.BadSignature.selector);
        registry.pay(a, sig);
    }

    function test_aSignedPaymentWorksOnce() public {
        IMandateRegistry.PaymentAuth memory a = _auth(id, airline, 1e6, 1);
        bytes memory sig = _sign(tripKey, registry.paymentDigest(a));
        registry.pay(a, sig);
        vm.expectRevert(IMandateRegistry.NonceUsed.selector);
        registry.pay(a, sig);
    }

    function test_expiredAuthorization() public {
        IMandateRegistry.PaymentAuth memory a = _auth(id, airline, 1e6, 1);
        bytes memory sig = _sign(tripKey, registry.paymentDigest(a));
        vm.warp(a.validBefore);
        vm.expectRevert(IMandateRegistry.AuthExpired.selector);
        registry.pay(a, sig);
    }

    function test_expiredMandate() public {
        vm.warp(block.timestamp + 1 days);
        assertFalse(registry.isActive(id));
        _payReverts(tripKey, id, airline, 1e6, 1, IMandateRegistry.MandateInactive.selector);
    }

    function test_unknownMandate() public {
        _payReverts(tripKey, 99, airline, 1e6, 1, IMandateRegistry.UnknownMandate.selector);
    }

    function testFuzz_neverPaysMoreThanTheBudget(uint96[6] memory amounts) public {
        uint256 paid;
        for (uint256 i; i < amounts.length; ++i) {
            uint256 amount = bound(amounts[i], 1, CAP);
            if (paid + amount > BUDGET) {
                _payReverts(tripKey, id, airline, amount, i, IMandateRegistry.OverBudget.selector);
            } else {
                _pay(tripKey, id, airline, amount, i);
                paid += amount;
            }
        }
        assertEq(usdc.balanceOf(airline), paid);
        assertLe(paid, BUDGET);
    }
}
