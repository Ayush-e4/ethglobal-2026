// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MandateEscrow} from "./mandate/MandateEscrow.sol";

/// @title MandateRegistry
/// @notice Spending limits for AI agents. An owner approves this contract to spend their token
///   (e.g. USDC) and creates mandates; agents then sign each payment. Every payment is checked
///   here (signer, expiry, revocation up the whole tree, single-use nonce, per-payment cap,
///   budget, allowed payees) before exactly that amount moves. Payments go straight to the
///   payee, or wait in escrow with an undo window until the job is delivered (MandateEscrow).
/// @dev Money only sits here while held, and only escrow rules move it. No admin and not
///   upgradeable: nobody, its authors included, can change the rules or touch the money.
///   It also holds a little HBAR (anyone can top it up) to pay for its scheduled payouts; that
///   HBAR can only be spent on network fees.
///   Implements the x402 Hedera `transferExecutor` interface (`executeTransfer`, selector
///   0xea8f19fd) so an x402 facilitator can settle through it.
// slither-disable-next-line locked-ether
contract MandateRegistry is MandateEscrow {
    using SafeERC20 for IERC20;

    /// @notice HBAR for scheduled payouts' fees.
    receive() external payable {}

    /// @notice The owner creates a root mandate for an agent. Funds stay with the owner.
    function createMandate(MandateParams calldata p) external returns (uint256 id) {
        if (
            p.agent == address(0) || p.token == address(0) || p.budget == 0 || p.perPaymentCap == 0
                || p.perPaymentCap > p.budget || p.expiresAt <= block.timestamp
        ) revert InvalidParams();
        Mandate memory m;
        m.owner = msg.sender;
        m.agent = p.agent;
        m.token = p.token;
        m.budget = p.budget;
        m.perPaymentCap = p.perPaymentCap;
        m.expiresAt = p.expiresAt;
        m.restrictPayees = p.payees.length > 0;
        id = _store(m, p.payees);
    }

    /// @notice A sub-mandate, signed by the parent's agent: its budget is carved out of the
    ///   parent's, and its limits can only be tighter (cap, expiry, payees).
    function createSubMandate(
        SubMandateAuth calldata a,
        address[] calldata payees,
        bytes calldata signature
    ) external returns (uint256 id) {
        Mandate storage parent = _requireActive(a.parentId);
        if (parent.depth >= MAX_DEPTH) revert TooDeep();
        if (keccak256(abi.encodePacked(payees)) != a.payeesHash) revert InvalidParams();
        _useNonce(a.parentId, a.nonce, a.validBefore);
        _requireSignedBy(parent.agent, subMandateDigest(a), signature);
        if (
            a.agent == address(0) || a.budget == 0 || a.perPaymentCap == 0
                || a.perPaymentCap > a.budget || a.perPaymentCap > parent.perPaymentCap
                || a.expiresAt <= block.timestamp || a.expiresAt > parent.expiresAt
        ) revert InvalidParams();
        if (a.budget > _remaining(parent)) revert OverBudget();
        if (parent.restrictPayees) {
            if (payees.length == 0) revert PayeeNotAllowed();
            for (uint256 i; i < payees.length; ++i) {
                if (!isPayeeAllowed[a.parentId][payees[i]]) revert PayeeNotAllowed();
            }
        }
        parent.delegated += a.budget;

        Mandate memory m;
        m.owner = parent.owner;
        m.agent = a.agent;
        m.token = parent.token;
        m.parentId = a.parentId;
        m.budget = a.budget;
        m.perPaymentCap = a.perPaymentCap;
        m.expiresAt = a.expiresAt;
        m.depth = parent.depth + 1;
        m.restrictPayees = payees.length > 0;
        id = _store(m, payees);
    }

    /// @notice Settles one agent-signed payment straight to the payee. Anyone may submit it;
    ///   the signature is what authorises it.
    function pay(PaymentAuth calldata a, bytes calldata signature) external {
        _pay(a, signature);
    }

    /// @notice x402 Hedera `transferExecutor` entry point.
    /// @param authorization abi.encode(mandateId, nonce, validBefore, signature): the agent's
    ///   EIP-712 PaymentAuth. `from` and `asset` must be the mandate's owner and token.
    function executeTransfer(
        address from,
        address asset,
        address to,
        uint256 amount,
        bytes calldata authorization
    ) external {
        (uint256 mandateId, uint256 nonce, uint256 validBefore, bytes memory signature) =
            abi.decode(authorization, (uint256, uint256, uint256, bytes));
        Mandate storage m = _mandates[mandateId];
        if (m.owner != from || m.token != asset) revert WrongOwnerOrAsset();
        _pay(PaymentAuth(mandateId, to, amount, nonce, validBefore), signature);
    }

    /// @notice Stops a mandate and, because payments check every ancestor, all its
    ///   sub-mandates. The owner, the mandate's agent or the parent's agent may do it.
    ///   Money already held in escrow keeps following the escrow rules.
    function revoke(uint256 id) external {
        Mandate storage m = _mandates[id];
        if (m.owner == address(0)) revert UnknownMandate();
        bool allowed = msg.sender == m.owner || msg.sender == m.agent
            || (m.parentId != 0 && msg.sender == _mandates[m.parentId].agent);
        if (!allowed) revert NotAuthorized();
        m.revoked = true;
        emit Revoked(id, msg.sender);
    }

    function _pay(PaymentAuth memory a, bytes memory signature) internal {
        Mandate storage m = _authorize(
            a.mandateId, a.payTo, a.amount, a.nonce, a.validBefore, paymentDigest(a), signature
        );
        // `from` is the mandate's owner, who approved this contract; every rule above bounds it.
        // forge-lint: disable-start(arbitrary-send-erc20)
        // slither-disable-next-line arbitrary-send-erc20
        IERC20(m.token).safeTransferFrom(m.owner, a.payTo, a.amount);
        // forge-lint: disable-end(arbitrary-send-erc20)
    }
}
