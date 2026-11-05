// Live x402 on Hedera testnet, end to end with no human: our facilitator and a merchant run here;
// an AI agent pays a per-call quote and books a room on pay-on-delivery terms, through the
// spending limit. Then the merchant delivers and Hedera pays it out by itself.
// Run: pnpm --filter @app/x402 demo
import { account, createAccount, createClient, hashscan, loadConfig, NETWORKS } from "@app/hedera";
import { MandateClient, registryAddress, tokenIdToEvmAddress } from "@app/mandates";
import { formatUsdc, parseUsdc } from "@app/shared";
import { serve } from "@hono/node-server";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import { HTTPFacilitatorClient, type RouteConfig } from "@x402/core/server";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { Hono } from "hono";
import { keccak256, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  createFacilitator,
  facilitatorApp,
  HederaIds,
  MandateClientScheme,
  MandateServerScheme,
  NETWORK,
  type SignedPayment,
} from "../src";

const config = loadConfig();
const net = NETWORKS[config.network];
const link = hashscan(config.network);
const registryId = process.env.MANDATE_REGISTRY_ID ?? "";
const registry = new MandateClient(registryAddress());
const ids = new HederaIds(net.mirrorUrl);
const owner = account(config, "operator"); // holds the test USDC: the user, in this demo
const ownerEvm = privateKeyToAccount(`0x${owner.key}`);
const agent = privateKeyToAccount(generatePrivateKey()); // the AI: only signs
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
const now = () => Math.floor(Date.now() / 1000);
const ok = (msg: string, tx?: string) => console.log(`✓ ${msg}${tx ? `  ${link.tx(tx)}` : ""}`);

// The merchant (a hotel) gets its own account.
const hc = createClient(config.network, owner);
const hotel = await createAccount(hc, { initialHbar: 10, memo: "x402 demo hotel" });
hc.close();
const hotelEvm = privateKeyToAccount(`0x${hotel.key}`);
ok(`hotel ${hotel.id}`);

// 1. Our facilitator, and the hotel's API behind an x402 paywall.
const F = 8790;
const M = 8791;
serve({ fetch: facilitatorApp(createFacilitator(config, registryId)).fetch, port: F });
const resource = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: `http://localhost:${F}` }),
).register(NETWORK, new MandateServerScheme([registryId]));
const book = (payee: string): RouteConfig => ({
  accepts: {
    scheme: "exact",
    network: NETWORK,
    price: "$0.02",
    payTo: registryId, // held in the registry until delivered
    extra: { escrow: { payee, undoSeconds: 20, deliverWithinSeconds: 3600, reviewSeconds: 20 } },
  },
  description: "Book a room, pay on delivery",
});
const shop = new Hono();
shop.use(
  paymentMiddleware(
    {
      "GET /quote": {
        accepts: { scheme: "exact", network: NETWORK, price: "$0.001", payTo: hotel.id },
        description: "A live room quote",
      },
      "POST /book": book(hotelEvm.address),
      "POST /book-elsewhere": book(privateKeyToAccount(generatePrivateKey()).address),
    },
    resource,
  ),
);
shop.get("/quote", (c) => c.json({ hotel: "Sea Breeze, Goa", perNightInr: 4200 }));
shop.post("/book", (c) =>
  c.json({ status: "accepted", note: "paid into escrow; we start after the undo window" }),
);
shop.post("/book-elsewhere", (c) => c.json({ status: "should never run" }));
serve({ fetch: shop.fetch, port: M });
ok(`facilitator on :${F}, hotel API on :${M} (x402 paywall)`);

// 2. The user gives the AI a spending limit: 0.10 USDC, only this hotel.
const budget = parseUsdc("0.10");
if ((await registry.allowance(tokenIdToEvmAddress(net.usdcTokenId), ownerEvm.address)) < budget) {
  await registry.approve(ownerEvm, tokenIdToEvmAddress(net.usdcTokenId), budget);
}
const { id: mandateId, receipt } = await registry.createMandate(ownerEvm, {
  agent: agent.address,
  token: tokenIdToEvmAddress(net.usdcTokenId),
  budget,
  perPaymentCap: parseUsdc("0.05"),
  expiresAt: BigInt(now() + 3600),
  payees: [hotelEvm.address],
});
ok(`limit #${mandateId}: 0.10 USDC, only the hotel`, receipt.transactionHash);

// 3. The AI pays with plain fetch, wrapped by the official x402 client. No human approves.
const signed: SignedPayment[] = [];
const scheme = new MandateClientScheme({
  agent,
  mandateId,
  owner: owner.id,
  registry,
  ids,
  minUndoSeconds: 10,
  onSigned: (p) => signed.push(p),
});
// Remembers the last payment header sent, to try replaying it below.
let lastSignature = "";
const recording: typeof fetch = async (input, init) => {
  // The paid retry is a Request from another copy of the fetch API, so no `instanceof` here.
  const fromInput = typeof input === "object" && "headers" in input ? input.headers : undefined;
  const headers = new Headers(init?.headers ?? fromInput);
  lastSignature = headers.get("PAYMENT-SIGNATURE") ?? lastSignature;
  return fetch(input, init);
};
const pay = wrapFetchWithPayment(recording, new x402Client().register(NETWORK, scheme));
const paid = (r: Response) => decodePaymentResponseHeader(r.headers.get("PAYMENT-RESPONSE") ?? "");
const why = (r: Response) => {
  const settled = r.headers.get("PAYMENT-RESPONSE");
  if (settled) {
    const s = decodePaymentResponseHeader(settled);
    if (!s.success) return `${s.errorReason}${s.errorMessage ? ` (${s.errorMessage})` : ""}`;
  }
  const h = r.headers.get("PAYMENT-REQUIRED");
  return h ? (decodePaymentRequiredHeader(h).error ?? "payment required") : "payment required";
};

const quote = await pay(`http://localhost:${M}/quote`);
ok(
  `quote ${JSON.stringify(await quote.json())}: paid 0.001 USDC per call`,
  paid(quote).transaction,
);

const res = await pay(`http://localhost:${M}/book`, { method: "POST" });
const bookSignature = lastSignature;
const held = signed.at(-1);
if (res.status !== 200 || !held?.escrowId) throw new Error(`booking failed: ${res.status}`);
const booked = (await res.json()) as { status: string };
ok(`booked (${booked.status}): 0.02 USDC held in escrow`, paid(res).transaction);
console.log(
  `  escrow ${(await registry.getEscrow(held.escrowId)).state}; limit left ${formatUsdc(await registry.remaining(mandateId))} USDC`,
);

// 4. Refusals.
const elsewhere = await pay(`http://localhost:${M}/book-elsewhere`, { method: "POST" });
console.log(`✓ paying a merchant outside the limit: HTTP ${elsewhere.status}, ${why(elsewhere)}`);
const replay = await fetch(`http://localhost:${M}/book`, {
  method: "POST",
  headers: { "PAYMENT-SIGNATURE": bookSignature },
});
console.log(`✓ replaying the booking's payment: HTTP ${replay.status}, ${why(replay)}`);
const unpaid = await fetch(`http://localhost:${M}/book`, { method: "POST" });
console.log(`✓ no payment at all: HTTP ${unpaid.status}, ${why(unpaid)}`);

// 5. After the undo window the hotel delivers; Hedera pays it out when the review ends.
const e = await registry.getEscrow(held.escrowId);
await sleep(Number(e.startsAt) - now() + 4);
const delivered = await registry.markDelivered(
  hotelEvm,
  held.escrowId,
  keccak256(toHex("ROOM-GOA-1")),
);
const s = registry.payoutSchedule(delivered);
ok(
  `hotel delivered; payout scheduled on Hedera${s ? ` (schedule ${s.schedule})` : ""}`,
  delivered.transactionHash,
);
if (s) {
  await sleep(Number(s.at) - now() + 8);
  for (let i = 0; i < 10 && (await registry.getEscrow(held.escrowId)).state !== "released"; i++)
    await sleep(3);
}
const final = (await registry.getEscrow(held.escrowId)).state;
console.log(
  `${final === "released" ? "✓" : "✗"} escrow ${final}: the hotel was paid by the network`,
);
process.exit(final === "released" ? 0 : 1);
