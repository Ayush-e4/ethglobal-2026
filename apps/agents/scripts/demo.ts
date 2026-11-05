// Live: StayWise on testnet + LiteAPI's sandbox. The AI gets a firm quote, books it over x402
// (fee held, undo window), StayWise books the room after the window and Hedera pays it. A second
// booking is undone in its window: nothing is booked, the money comes back.
// Run: pnpm --filter @app/agents demo
import { account, loadConfig, NETWORKS } from "@app/hedera";
import { MandateClient, registryAddress, tokenIdToEvmAddress } from "@app/mandates";
import { formatUsdc, parseUsdc } from "@app/shared";
import {
  createFacilitator,
  facilitatorApp,
  HederaIds,
  MandateClientScheme,
  NETWORK,
  type SignedPayment,
} from "@app/x402";
import { serve } from "@hono/node-server";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadStayWiseConfig } from "../src/staywise/config";
import { startStayWise } from "../src/staywise/service";

const hedera = loadConfig();
const net = NETWORKS[hedera.network];
const sw = loadStayWiseConfig();
const registry = new MandateClient(registryAddress());
const owner = privateKeyToAccount(`0x${account(hedera, "operator").key}`);
const ai = privateKeyToAccount(generatePrivateKey());
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const base = `http://localhost:${sw.port}`;

serve({ fetch: facilitatorApp(createFacilitator(hedera, sw.registryId)).fetch, port: 8790 });
const { app, agent, listed } = await startStayWise(sw);
serve({ fetch: app.fetch, port: sw.port });
console.log(
  `✓ StayWise ${agent.address} running (${listed ? "already listed" : "listed now"} on Arkiv)`,
);

const usdc = tokenIdToEvmAddress(net.usdcTokenId);
if ((await registry.allowance(usdc, owner.address)) < parseUsdc("0.10"))
  await registry.approve(owner, usdc, parseUsdc("0.10"));
const { id: mandateId } = await registry.createMandate(owner, {
  agent: ai.address,
  token: usdc,
  budget: parseUsdc("0.10"),
  perPaymentCap: parseUsdc("0.05"),
  expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
  payees: [agent.address],
});
console.log(`✓ limit #${mandateId}: 0.10 USDC, StayWise only`);

const signed: SignedPayment[] = [];
const pay = wrapFetchWithPayment(
  fetch,
  new x402Client().register(
    NETWORK,
    new MandateClientScheme({
      agent: ai,
      mandateId,
      owner: account(hedera, "operator").id,
      registry,
      ids: new HederaIds(net.mirrorUrl),
      minUndoSeconds: 30,
      onSigned: (p) => signed.push(p),
    }),
  ),
);
const guest = {
  firstName: "Test",
  lastName: "Traveller",
  email: "test.traveller@example.com",
  phone: "+919800000000",
};

async function quoteAndBook(task: string) {
  const qr = await fetch(
    `${base}/quote?task=${task}&iata=GOI&checkin=${day(30)}&checkout=${day(32)}&adults=2`,
  );
  const quote = (await qr.json()) as {
    key: Hex;
    hotelName: string;
    total: number;
    currency: string;
    feeUnits: string;
  };
  if (!qr.ok) throw new Error(`quote failed: ${qr.status} ${JSON.stringify(quote)}`);
  console.log(
    `✓ quote: ${quote.hotelName}, ${quote.currency} ${Math.round(quote.total)} (fee ${formatUsdc(BigInt(quote.feeUnits))} USDC), on Arkiv ${quote.key.slice(0, 10)}…`,
  );
  const res = await pay(`${base}/book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quote: quote.key, guest }),
  });
  const body = (await res.json()) as { escrowId: Hex; startsAt: number };
  if (res.status !== 202) throw new Error(`book failed: ${res.status} ${JSON.stringify(body)}`);
  console.log(
    `✓ booked over x402: fee held in escrow ${body.escrowId.slice(0, 10)}…, StayWise starts after the undo window`,
  );
  return body;
}

async function waitJob(escrowId: Hex, until: string[]) {
  for (let i = 0; i < 60; i++) {
    const job = (await (await fetch(`${base}/jobs/${escrowId}`)).json()) as {
      status: string;
      bookingId?: string;
      confirmation?: string;
      note?: string;
    };
    if (until.includes(job.status)) return job;
    await sleep(5);
  }
  throw new Error("job didn't finish");
}

// 1. Booked and delivered.
const first = await quoteAndBook(`goa-${Date.now().toString(36)}`);
const done = await waitJob(first.escrowId, ["delivered", "refunded", "failed", "cancelled"]);
console.log(
  `${done.status === "delivered" ? "✓" : "✗"} StayWise ${done.status}: LiteAPI sandbox booking ${done.bookingId ?? "-"}${done.confirmation ? ` (hotel ref ${done.confirmation})` : ""}${done.note ? ` ${done.note}` : ""}`,
);

// 2. Undone in the window: nothing booked.
const second = await quoteAndBook(`goa-undo-${Date.now().toString(36)}`);
await registry.cancel(owner, second.escrowId);
console.log("✓ the user pressed undo inside the window");
const undone = await waitJob(second.escrowId, ["cancelled", "delivered", "refunded", "failed"]);
console.log(
  `${undone.status === "cancelled" && !undone.bookingId ? "✓" : "✗"} StayWise ${undone.status}: ${undone.note ?? ""}`,
);

// 3. Hedera pays StayWise for the first one when the review ends.
for (let i = 0; i < 40 && (await registry.getEscrow(first.escrowId)).state !== "released"; i++)
  await sleep(5);
const paid = (await registry.getEscrow(first.escrowId)).state;
console.log(
  `${paid === "released" ? "✓" : "✗"} first booking's fee ${paid}: paid to StayWise by the network`,
);
console.log(
  `  limit left ${formatUsdc(await registry.remaining(mandateId))} USDC (the undone fee came back)`,
);
process.exit(
  done.status === "delivered" && undone.status === "cancelled" && paid === "released" ? 0 : 1,
);
