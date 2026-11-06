// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {PasskeySignature} from "../../src/wallet/PasskeySignature.sol";
import {PasskeyWallet} from "../../src/wallet/PasskeyWallet.sol";
import {PasskeyWalletFactory} from "../../src/wallet/PasskeyWalletFactory.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @dev A wallet made by the phone's passkey, holding 5 test USDC, and devices that answer a
///   challenge the way a browser's WebAuthn does.
abstract contract PasskeyBase is Test {
    uint256 constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 constant PHONE = 0x5eed;
    uint256 constant LAPTOP = 0xbeef;
    bytes1 constant FACE_ID = 0x05; // user present + user verified
    bytes1 constant TAP_ONLY = 0x01; // present, not verified

    PasskeyWalletFactory factory;
    PasskeyWallet wallet;
    MockUSDC usdc;
    address payee = makeAddr("payee");

    function setUp() public virtual {
        factory = new PasskeyWalletFactory();
        usdc = new MockUSDC();
        (bytes32 x, bytes32 y) = _pub(PHONE);
        wallet = PasskeyWallet(payable(factory.create(x, y, address(0))));
        usdc.mint(address(wallet), 5e6);
    }

    function _pub(uint256 key) internal pure returns (bytes32, bytes32) {
        (uint256 x, uint256 y) = vm.publicKeyP256(key);
        return (bytes32(x), bytes32(y));
    }

    /// What device `key` returns for challenge `d`: Face ID on a "get" ceremony.
    function _sign(uint256 key, bytes32 d) internal pure returns (PasskeyWallet.KeySig memory) {
        return _sign(key, d, FACE_ID, "webauthn.get");
    }

    function _sign(uint256 key, bytes32 d, bytes1 flags, string memory ceremony)
        internal
        pure
        returns (PasskeyWallet.KeySig memory k)
    {
        PasskeySignature.Assertion memory a;
        a.authenticatorData = abi.encodePacked(sha256("localhost"), flags, uint32(1));
        a.clientDataJSON = string.concat(
            '{"type":"',
            ceremony,
            '","challenge":"',
            Base64.encodeURL(abi.encodePacked(d)),
            '","origin":"http://localhost:3000"}'
        );
        a.typeIndex = 1;
        a.challengeIndex = 1 + 8 + bytes(ceremony).length + 2; // after `"type":"…",`
        bytes32 h = sha256(abi.encodePacked(a.authenticatorData, sha256(bytes(a.clientDataJSON))));
        (bytes32 r, bytes32 s) = vm.signP256(key, h);
        if (uint256(s) > N / 2) s = bytes32(N - uint256(s));
        (a.r, a.s) = (r, s);
        (k.qx, k.qy) = _pub(key);
        k.sig = a;
    }

    function _pay(uint256 amount) internal view returns (PasskeyWallet.Call[] memory c) {
        c = new PasskeyWallet.Call[](1);
        c[0] = PasskeyWallet.Call(address(usdc), 0, abi.encodeCall(usdc.transfer, (payee, amount)));
    }

    function _selfCall(bytes memory data) internal view returns (PasskeyWallet.Call[] memory c) {
        c = new PasskeyWallet.Call[](1);
        c[0] = PasskeyWallet.Call(address(wallet), 0, data);
    }

    /// Signs `calls` with `key` and runs them (expecting `err` if it isn't empty).
    function _run(uint256 key, PasskeyWallet.Call[] memory calls, bytes memory err) internal {
        uint256 deadline = block.timestamp + 300;
        PasskeyWallet.KeySig memory k = _sign(key, wallet.digest(calls, deadline));
        if (err.length > 0) vm.expectRevert(err);
        wallet.execute(calls, deadline, k);
    }
}
