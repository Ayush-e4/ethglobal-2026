// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Types, events and errors for MandateRegistry.
/// A mandate is a spending limit an owner gives an agent: a budget, a per-payment cap, an expiry
/// and (optionally) a list of allowed payees. Funds stay in the owner's account; the registry
/// pulls them through an ERC-20 allowance only for a payment that passes every rule.
interface IMandateRegistry {
    /// Arguments for a root mandate (the owner calls createMandate).
    struct MandateParams {
        address agent; // key that signs each payment
        address token; // e.g. USDC's EVM address
        uint128 budget; // the most the agent may spend or hand on, in total
        uint128 perPaymentCap; // the most for one payment
        uint64 expiresAt; // unix seconds
        address[] payees; // who it may pay; empty = anyone
    }

    struct Mandate {
        address owner; // whose money it is (the same for a whole tree)
        address agent;
        address token;
        uint256 parentId; // 0 for a root mandate
        uint128 budget;
        uint128 spent; // paid or held by this mandate
        uint128 delegated; // handed on to sub-mandates
        uint128 perPaymentCap;
        uint64 expiresAt;
        uint8 depth; // 0 for a root
        bool revoked;
        bool restrictPayees;
    }

    /// What an agent signs to pay straight away.
    struct PaymentAuth {
        uint256 mandateId;
        address payTo;
        uint256 amount;
        uint256 nonce;
        uint256 validBefore;
    }

    /// What an agent signs to pay on delivery. The money waits in the registry: first an undo
    /// window (the owner or the agent can cancel, the payee can't start), then until delivery.
    struct EscrowAuth {
        uint256 mandateId;
        address payTo;
        uint256 amount;
        uint256 nonce;
        uint256 validBefore;
        uint32 undoSeconds; // cancel window before the payee may deliver
        uint64 deliverBy; // the payee must deliver by then, or it can be reclaimed
        uint32 reviewSeconds; // after delivery, the buyer can dispute for this long
    }

    /// The x402 form of an EscrowAuth. x402 pays `amount` to the registry itself (the money is
    /// held there), so the merchant who gets it on delivery travels in the terms.
    struct EscrowTerms {
        uint256 mandateId;
        address payee;
        uint256 nonce;
        uint256 validBefore;
        uint32 undoSeconds;
        uint64 deliverBy;
        uint32 reviewSeconds;
    }

    enum EscrowState {
        None,
        Held, // paid in: undo window, then waiting for delivery
        Delivered, // the payee says it's done; the buyer may release or dispute, or let it lapse
        Disputed, // the buyer objected: frozen until the payee refunds or the buyer releases
        Released, // paid out to the payee
        Refunded // back to the owner (cancelled, refunded or never delivered)
    }

    struct Escrow {
        uint256 mandateId;
        address payee;
        uint64 startsAt; // end of the undo window
        uint64 deliverBy;
        uint32 reviewSeconds;
        uint128 amount;
        uint64 deliveredAt;
        EscrowState state;
        bytes32 resultHash; // a hash of what the payee delivered (the result stays private)
    }

    /// What a parent mandate's agent signs to give another agent a slice of its budget.
    struct SubMandateAuth {
        uint256 parentId;
        address agent;
        uint128 budget;
        uint128 perPaymentCap;
        uint64 expiresAt;
        bytes32 payeesHash; // keccak256(abi.encodePacked(payees))
        uint256 nonce;
        uint256 validBefore;
    }

    event MandateCreated(
        uint256 indexed id,
        uint256 indexed parentId,
        address indexed owner,
        address agent,
        uint128 budget,
        uint128 perPaymentCap,
        uint64 expiresAt
    );
    event Paid(uint256 indexed mandateId, address indexed payTo, uint256 amount, uint256 nonce);
    event Revoked(uint256 indexed mandateId, address indexed by);
    event Escrowed(
        bytes32 indexed id,
        uint256 indexed mandateId,
        address indexed payee,
        uint256 amount,
        uint64 startsAt,
        uint64 deliverBy
    );
    event EscrowCancelled(bytes32 indexed id, address indexed by);
    event Delivered(bytes32 indexed id, bytes32 resultHash);
    event EscrowReleased(bytes32 indexed id, address indexed by);
    event EscrowRefunded(bytes32 indexed id, address indexed by);
    event EscrowDisputed(bytes32 indexed id);
    /// Hedera will call `claim(id)` at `at` by itself (HIP-1215), paying the merchant on time.
    event PayoutScheduled(bytes32 indexed id, address schedule, uint256 at);
    /// The network couldn't schedule it (`code` from Hedera, -1 if unavailable): anyone can still
    /// call `claim` once the review ends.
    event PayoutNotScheduled(bytes32 indexed id, int64 code);

    error InvalidParams();
    error UnknownMandate();
    error MandateInactive(); // revoked or expired, itself or an ancestor
    error AuthExpired();
    error NonceUsed();
    error BadSignature();
    error OverPaymentCap();
    error OverBudget();
    error PayeeNotAllowed();
    error NotAuthorized();
    error TooDeep();
    error WrongOwnerOrAsset(); // x402: from/asset don't match the mandate
    error UnknownEscrow();
    error WrongEscrowState();
    error TooEarly();
    error TooLate();
    error AssociationFailed(int64 code); // Hedera: the registry couldn't opt in to the token
}
