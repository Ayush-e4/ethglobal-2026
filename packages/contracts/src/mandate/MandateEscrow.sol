// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MandateStore} from "./MandateStore.sol";

/// @notice Pay on delivery, with an undo window. A held payment passes the same checks as a
///   direct one, but the money waits in the registry:
///   1. Undo window (`undoSeconds`): the buyer (the owner or the mandate's agent) can cancel for
///      a full refund, and the payee can't mark anything delivered yet.
///   2. The payee delivers by `deliverBy`, with a hash of what it delivered.
///   3. The buyer releases it, or after `reviewSeconds` anyone can pay it out (so a Hedera
///      scheduled transaction can, with no server involved). Within the review the buyer can
///      dispute, which freezes it until the payee refunds or the buyer releases.
///   The payee can refund at any time; if nothing is delivered by `deliverBy`, anyone can send
///   it back. Every refund also gives the budget back to the mandate.
///   Web2 analogy: Gmail's "Undo send" plus an escrow service, run by code nobody can change.
abstract contract MandateEscrow is MandateStore {
    using SafeERC20 for IERC20;

    uint32 public constant MAX_UNDO = 7 days;
    uint32 public constant MAX_REVIEW = 30 days;

    /// Hedera's token service precompile, and the answers we accept from it.
    address internal constant HTS = address(0x167);
    int64 internal constant HTS_SUCCESS = 22;
    int64 internal constant HTS_ALREADY_ASSOCIATED = 194;

    mapping(bytes32 id => Escrow) internal _escrows;

    /// @notice One escrow per payment: its id follows from the mandate and the payment's nonce.
    function escrowIdOf(uint256 mandateId, uint256 nonce) public pure returns (bytes32) {
        return keccak256(abi.encode(mandateId, nonce));
    }

    function getEscrow(bytes32 id) external view returns (Escrow memory) {
        return _escrows[id];
    }

    /// @notice x402 entry point for pay on delivery (like `executeTransfer`).
    /// @param authorization abi.encode(EscrowTerms, signature): the agent's EIP-712 EscrowAuth
    ///   over those terms plus `to` and `amount`.
    function executeEscrowTransfer(
        address from,
        address asset,
        address to,
        uint256 amount,
        bytes calldata authorization
    ) external returns (bytes32) {
        (EscrowTerms memory t, bytes memory signature) =
            abi.decode(authorization, (EscrowTerms, bytes));
        Mandate storage m = _mandates[t.mandateId];
        if (m.owner != from || m.token != asset) revert WrongOwnerOrAsset();
        return _escrow(
            EscrowAuth(
                t.mandateId,
                to,
                amount,
                t.nonce,
                t.validBefore,
                t.undoSeconds,
                t.deliverBy,
                t.reviewSeconds
            ),
            signature
        );
    }

    /// @notice The same without x402: anyone may submit an agent-signed EscrowAuth.
    function payIntoEscrow(EscrowAuth calldata a, bytes calldata signature)
        external
        returns (bytes32)
    {
        return _escrow(a, signature);
    }

    /// @notice Undo: the buyer takes it back before the window ends. Nothing reaches the payee.
    function cancel(bytes32 id) external {
        Escrow storage e = _escrowOf(id);
        if (!_isBuyer(e.mandateId, msg.sender)) revert NotAuthorized();
        if (e.state != EscrowState.Held) revert WrongEscrowState();
        if (block.timestamp >= e.startsAt) revert TooLate();
        _refund(e);
        emit EscrowCancelled(id, msg.sender);
    }

    /// @notice The payee says the job is done: after the undo window, by `deliverBy`.
    function markDelivered(bytes32 id, bytes32 resultHash) external {
        Escrow storage e = _escrowOf(id);
        if (msg.sender != e.payee) revert NotAuthorized();
        if (e.state != EscrowState.Held) revert WrongEscrowState();
        if (block.timestamp < e.startsAt) revert TooEarly();
        if (block.timestamp > e.deliverBy) revert TooLate();
        e.state = EscrowState.Delivered;
        // forge-lint: disable-next-line(unsafe-typecast)
        e.deliveredAt = uint64(block.timestamp); // <= deliverBy, a uint64
        e.resultHash = resultHash;
        emit Delivered(id, resultHash);
    }

    /// @notice The buyer is happy: pay the payee now.
    function release(bytes32 id) external {
        Escrow storage e = _escrowOf(id);
        if (!_isBuyer(e.mandateId, msg.sender)) revert NotAuthorized();
        if (!_open(e)) revert WrongEscrowState();
        _payOut(e, e.payee, EscrowState.Released);
        emit EscrowReleased(id, msg.sender);
    }

    /// @notice Delivered and the review passed without a dispute: anyone may pay it out.
    function claim(bytes32 id) external {
        Escrow storage e = _escrowOf(id);
        if (e.state != EscrowState.Delivered) revert WrongEscrowState();
        if (block.timestamp < uint256(e.deliveredAt) + e.reviewSeconds) revert TooEarly();
        _payOut(e, e.payee, EscrowState.Released);
        emit EscrowReleased(id, msg.sender);
    }

    /// @notice The buyer objects to what was delivered, within the review.
    function dispute(bytes32 id) external {
        Escrow storage e = _escrowOf(id);
        if (!_isBuyer(e.mandateId, msg.sender)) revert NotAuthorized();
        if (e.state != EscrowState.Delivered) revert WrongEscrowState();
        if (block.timestamp >= uint256(e.deliveredAt) + e.reviewSeconds) revert TooLate();
        e.state = EscrowState.Disputed;
        emit EscrowDisputed(id);
    }

    /// @notice The payee gives the money back (couldn't deliver, or settles a dispute).
    function refund(bytes32 id) external {
        Escrow storage e = _escrowOf(id);
        if (msg.sender != e.payee) revert NotAuthorized();
        if (!_open(e)) revert WrongEscrowState();
        _refund(e);
        emit EscrowRefunded(id, msg.sender);
    }

    /// @notice Never delivered by the deadline: anyone may send it back to the owner.
    function reclaim(bytes32 id) external {
        Escrow storage e = _escrowOf(id);
        if (e.state != EscrowState.Held) revert WrongEscrowState();
        if (block.timestamp <= e.deliverBy) revert TooEarly();
        _refund(e);
        emit EscrowRefunded(id, msg.sender);
    }

    /// @notice Hedera: lets the registry hold `token` (every account opts in to each token).
    function associate(address token) external {
        if (token == address(0)) revert InvalidParams();
        // slither-disable-next-line low-level-calls
        (bool ok, bytes memory res) = HTS.call(
            abi.encodeWithSignature("associateToken(address,address)", address(this), token)
        );
        int64 code = ok && res.length >= 32 ? abi.decode(res, (int64)) : int64(-1);
        if (code != HTS_SUCCESS && code != HTS_ALREADY_ASSOCIATED) revert AssociationFailed(code);
    }

    function _escrow(EscrowAuth memory a, bytes memory signature) internal returns (bytes32 id) {
        uint256 startsAt = block.timestamp + a.undoSeconds;
        if (a.undoSeconds > MAX_UNDO || a.reviewSeconds > MAX_REVIEW || a.deliverBy <= startsAt) {
            revert InvalidParams();
        }
        Mandate storage m = _authorize(
            a.mandateId, a.payTo, a.amount, a.nonce, a.validBefore, escrowDigest(a), signature
        );
        id = escrowIdOf(a.mandateId, a.nonce);
        _escrows[id] = Escrow({
            mandateId: a.mandateId,
            payee: a.payTo,
            // forge-lint: disable-next-line(unsafe-typecast)
            startsAt: uint64(startsAt), // < deliverBy, a uint64
            deliverBy: a.deliverBy,
            reviewSeconds: a.reviewSeconds,
            // forge-lint: disable-next-line(unsafe-typecast)
            amount: uint128(a.amount), // <= perPaymentCap (uint128), checked in _authorize
            deliveredAt: 0,
            state: EscrowState.Held,
            resultHash: bytes32(0)
        });
        // forge-lint: disable-next-line(unsafe-typecast)
        emit Escrowed(id, a.mandateId, a.payTo, a.amount, uint64(startsAt), a.deliverBy);
        // `from` is the mandate's owner, who approved this contract; every rule above bounds it.
        // forge-lint: disable-start(arbitrary-send-erc20)
        // slither-disable-next-line arbitrary-send-erc20
        IERC20(m.token).safeTransferFrom(m.owner, address(this), a.amount);
        // forge-lint: disable-end(arbitrary-send-erc20)
    }

    function _refund(Escrow storage e) internal {
        Mandate storage m = _mandates[e.mandateId];
        // Every caller emits EscrowCancelled or EscrowRefunded.
        // forge-lint: disable-next-line(missing-events-access-control)
        m.spent -= e.amount; // the money is back, so is the budget
        _payOut(e, m.owner, EscrowState.Refunded);
    }

    function _payOut(Escrow storage e, address to, EscrowState state) internal {
        e.state = state;
        IERC20(_mandates[e.mandateId].token).safeTransfer(to, e.amount);
    }

    function _escrowOf(bytes32 id) internal view returns (Escrow storage e) {
        e = _escrows[id];
        if (e.state == EscrowState.None) revert UnknownEscrow();
    }

    function _open(Escrow storage e) internal view returns (bool) {
        return e.state == EscrowState.Held || e.state == EscrowState.Delivered
            || e.state == EscrowState.Disputed;
    }

    function _isBuyer(uint256 mandateId, address who) internal view returns (bool) {
        Mandate storage m = _mandates[mandateId];
        return who == m.agent || who == m.owner;
    }
}
