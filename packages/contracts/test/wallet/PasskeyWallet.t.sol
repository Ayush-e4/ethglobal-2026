// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MandateRegistry} from "../../src/MandateRegistry.sol";
import {IMandateRegistry} from "../../src/mandate/IMandateRegistry.sol";
import {PasskeyWallet} from "../../src/wallet/PasskeyWallet.sol";
import {PasskeyBase} from "./PasskeyBase.t.sol";

/// @dev A passkey wallet setting a spending limit the way the app does: Face ID signs one batch
///   (approve USDC + create the limit) and anyone submits it.
contract PasskeyWalletTest is PasskeyBase {
    MandateRegistry registry;
    address concierge = makeAddr("concierge");
    address agent = makeAddr("agent");

    function setUp() public override {
        super.setUp();
        registry = new MandateRegistry();
    }

    function _limit(uint128 budget) internal view returns (PasskeyWallet.Call[] memory c) {
        address[] memory payees = new address[](1);
        payees[0] = agent;
        c = new PasskeyWallet.Call[](2);
        c[0] = PasskeyWallet.Call(
            address(usdc), 0, abi.encodeCall(usdc.approve, (address(registry), budget))
        );
        c[1] = PasskeyWallet.Call(
            address(registry),
            0,
            abi.encodeCall(
                registry.createMandate,
                (IMandateRegistry.MandateParams(
                        concierge,
                        address(usdc),
                        budget,
                        budget,
                        uint64(block.timestamp + 1 days),
                        payees
                    ))
            )
        );
    }

    function test_faceIdSetsASpendingLimit_anyoneSubmits() public {
        vm.prank(makeAddr("our server"));
        _run(PHONE, _limit(1e6), "");
        IMandateRegistry.Mandate memory m = registry.getMandate(1);
        assertEq(m.owner, address(wallet)); // the wallet owns the limit, not whoever sent it
        assertEq(m.agent, concierge);
        assertEq(usdc.allowance(address(wallet), address(registry)), 1e6);
        assertEq(wallet.nonce(), 1);
    }

    function test_refusesReplayTamperingAndOtherKeys() public {
        PasskeyWallet.Call[] memory calls = _limit(1e6);
        uint256 deadline = block.timestamp + 300;
        bytes32 d = wallet.digest(calls, deadline);
        PasskeyWallet.KeySig memory k = _sign(PHONE, d);

        vm.expectRevert(PasskeyWallet.BadSignature.selector);
        wallet.execute(_limit(5e6), deadline, k); // not what was signed

        PasskeyWallet.KeySig memory forged = _sign(LAPTOP, d);
        (forged.qx, forged.qy) = (k.qx, k.qy); // claims to be the phone
        vm.expectRevert(PasskeyWallet.BadSignature.selector);
        wallet.execute(calls, deadline, forged);

        wallet.execute(calls, deadline, k);
        vm.expectRevert(PasskeyWallet.BadSignature.selector);
        wallet.execute(calls, deadline, k); // used up: the nonce moved on
    }

    function test_needsFaceIdNotJustATap_andAGetCeremony() public {
        PasskeyWallet.Call[] memory calls = _limit(1e6);
        uint256 deadline = block.timestamp + 300;
        bytes32 d = wallet.digest(calls, deadline);
        PasskeyWallet.KeySig memory tapOnly = _sign(PHONE, d, TAP_ONLY, "webauthn.get");
        PasskeyWallet.KeySig memory create = _sign(PHONE, d, FACE_ID, "webauthn.create");
        vm.expectRevert(PasskeyWallet.BadSignature.selector);
        wallet.execute(calls, deadline, tapOnly); // present, but not verified
        vm.expectRevert(PasskeyWallet.BadSignature.selector);
        wallet.execute(calls, deadline, create); // a sign-up, not an approval
    }

    function test_expires_andFailsAsAWhole() public {
        PasskeyWallet.Call[] memory calls = _limit(1e6);
        uint256 deadline = block.timestamp + 300;
        PasskeyWallet.KeySig memory k = _sign(PHONE, wallet.digest(calls, deadline));
        vm.warp(deadline + 1);
        vm.expectRevert(PasskeyWallet.Expired.selector);
        wallet.execute(calls, deadline, k);

        // The registry refuses a zero budget, so the approve before it is rolled back too.
        bytes memory refused = abi.encodeWithSelector(
            PasskeyWallet.CallFailed.selector,
            1,
            abi.encodeWithSelector(IMandateRegistry.InvalidParams.selector)
        );
        _run(PHONE, _limit(0), refused);
        assertEq(usdc.allowance(address(wallet), address(registry)), 0);
        assertEq(wallet.nonce(), 0);
    }

    function test_erc1271() public view {
        bytes32 h = keccak256("anything");
        assertEq(wallet.isValidSignature(h, abi.encode(_sign(PHONE, h))), bytes4(0x1626ba7e));
        assertEq(
            wallet.isValidSignature(keccak256("else"), abi.encode(_sign(PHONE, h))),
            bytes4(0xffffffff)
        );
        assertEq(wallet.isValidSignature(h, abi.encode(_sign(LAPTOP, h))), bytes4(0xffffffff));
    }

    function test_oneWalletPerPasskey_atAKnownAddress() public {
        (bytes32 x, bytes32 y) = _pub(PHONE);
        assertEq(factory.addressOf(x, y), address(wallet));
        assertEq(factory.create(x, y, address(0)), address(wallet)); // again: the same one
        (bytes32 lx, bytes32 ly) = _pub(LAPTOP);
        assertTrue(factory.addressOf(lx, ly) != address(wallet));
    }

    function test_onlyTheFactoryOptsItInToTokens() public {
        vm.expectRevert(PasskeyWallet.OnlyFactory.selector);
        wallet.associate(address(usdc));
    }
}
