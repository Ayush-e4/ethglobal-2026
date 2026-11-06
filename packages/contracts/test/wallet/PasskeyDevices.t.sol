// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PasskeyWallet} from "../../src/wallet/PasskeyWallet.sol";
import {PasskeyBase} from "./PasskeyBase.t.sol";

/// @dev Two devices, one wallet: the phone's passkey made it; the laptop's is let in by the
///   phone (a batch calling addKey), and can be shut out again the same way.
contract PasskeyDevicesTest is PasskeyBase {
    function test_theFirstPasskeyRunsTheWallet() public {
        _run(PHONE, _pay(1e6), "");
        assertEq(usdc.balanceOf(payee), 1e6);
        assertEq(wallet.keyCount(), 1);
    }

    function test_anotherDeviceGetsInOnlyWhenATrustedPasskeyLetsItIn() public {
        bytes memory notAKey = abi.encodeWithSelector(PasskeyWallet.NotAKey.selector);
        _run(LAPTOP, _pay(1e6), notAKey); // a stranger

        (bytes32 x, bytes32 y) = _pub(LAPTOP);
        vm.expectRevert(PasskeyWallet.OnlySelf.selector);
        wallet.addKey(x, y); // nobody can add a key from outside

        _run(PHONE, _selfCall(abi.encodeCall(wallet.addKey, (x, y))), "");
        assertEq(wallet.keyCount(), 2);
        _run(LAPTOP, _pay(2e6), ""); // now the laptop can
        assertEq(usdc.balanceOf(payee), 2e6);
    }

    function test_aLostDeviceIsShutOut_butNeverTheLastKey() public {
        (bytes32 lx, bytes32 ly) = _pub(LAPTOP);
        (bytes32 px, bytes32 py) = _pub(PHONE);
        _run(PHONE, _selfCall(abi.encodeCall(wallet.addKey, (lx, ly))), "");
        _run(PHONE, _selfCall(abi.encodeCall(wallet.removeKey, (lx, ly))), "");
        _run(LAPTOP, _pay(1e6), abi.encodeWithSelector(PasskeyWallet.NotAKey.selector));

        bytes memory lastKey = abi.encodeWithSelector(
            PasskeyWallet.CallFailed.selector,
            0,
            abi.encodeWithSelector(PasskeyWallet.LastKey.selector)
        );
        _run(PHONE, _selfCall(abi.encodeCall(wallet.removeKey, (px, py))), lastKey);
        assertEq(wallet.keyCount(), 1);
        vm.expectRevert(PasskeyWallet.OnlySelf.selector);
        wallet.removeKey(px, py); // and nobody from outside
    }

    function test_aDeviceCanRemoveItself() public {
        (bytes32 lx, bytes32 ly) = _pub(LAPTOP);
        _run(PHONE, _selfCall(abi.encodeCall(wallet.addKey, (lx, ly))), "");
        _run(LAPTOP, _selfCall(abi.encodeCall(wallet.removeKey, (lx, ly))), "");
        assertEq(wallet.keyCount(), 1);
        assertFalse(wallet.isKey(wallet.keyId(lx, ly)));
    }

    function test_addingAKeyTwiceCountsItOnce() public {
        (bytes32 px, bytes32 py) = _pub(PHONE);
        _run(PHONE, _selfCall(abi.encodeCall(wallet.addKey, (px, py))), "");
        assertEq(wallet.keyCount(), 1);
    }
}
