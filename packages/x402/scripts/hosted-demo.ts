// The plain x402 path through a facilitator listed in the Hedera docs (default x402.org;
// FACILITATOR_URL=https://api.testnet.blocky402.com for Blocky402). The payer signs an ordinary
// USDC transfer ("exact", cryptoTransfer) and the hosted facilitator pays the fee and submits it.
// Run: pnpm --filter @app/x402 hosted-demo
import { account, createAccount, createClient, hashscan, loadConfig } from "@app/hedera";
import { serve } from "@hono/node-server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { ExactHederaScheme as ExactClient } from "@x402/hedera/exact/client";
import { ExactHederaScheme as ExactServer } from "@x402/hedera/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { Hono } from "hono";
import { NETWORK } from "../src";

const facilitatorUrl = process.env.FACILITATOR_URL ?? "https://x402.org/facilitator";
const config = loadConfig();
const link = hashscan(config.network);
const payer = account(config, "operator"); // holds the test USDC

const c = createClient(config.network, payer);
const shopAccount = await createAccount(c, { initialHbar: 1, memo: "x402 hosted demo shop" });
c.close();
console.log(`✓ shop ${shopAccount.id}; facilitator ${facilitatorUrl}`);

const resource = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: facilitatorUrl }),
).register(NETWORK, new ExactServer());
const shop = new Hono();
shop.use(
  paymentMiddleware(
    {
      "GET /weather": {
        accepts: { scheme: "exact", network: NETWORK, price: "$0.001", payTo: shopAccount.id },
        description: "Goa weather",
      },
    },
    resource,
  ),
);
shop.get("/weather", (ctx) => ctx.json({ city: "Goa", tempC: 31 }));
const server = serve({ fetch: shop.fetch, port: 8792 });

const signer = createClientHederaSigner(payer.id, PrivateKey.fromStringECDSA(payer.key), {
  network: NETWORK,
});
const pay = wrapFetchWithPayment(
  fetch,
  new x402Client().register(NETWORK, new ExactClient(signer)),
);
const res = await pay("http://localhost:8792/weather");
const settled = decodePaymentResponseHeader(res.headers.get("PAYMENT-RESPONSE") ?? "");
if (res.status !== 200 || !settled.success) {
  console.log(`✗ HTTP ${res.status}: ${settled.errorReason ?? (await res.text())}`);
  process.exit(1);
}
console.log(
  `✓ ${JSON.stringify(await res.json())}: paid 0.001 USDC  ${link.tx(settled.transaction)}`,
);
server.close();
process.exit(0);
