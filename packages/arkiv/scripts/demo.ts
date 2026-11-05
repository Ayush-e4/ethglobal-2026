// Live on Arkiv's Rabdi testnet: an agent publishes itself and quotes a task; the platform records
// the hire, its receipt (pointing at a real Hedera payment), the delivery and a rating; then
// everything is read back through the trust rules, including a forged quote that must be ignored.
// Needs ARKIV_ACCESS_KEY and a funded ARKIV_WRITER_PRIVATE_KEY (pnpm --filter @app/arkiv arkiv-setup).
// Run: pnpm --filter @app/arkiv demo
import { createPublicClient, createWalletClient, type Hex, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  ARKIV_CHAIN,
  ARKIV_EXPLORER,
  arkivReader,
  deliveriesBy,
  findAgents,
  jobsForTask,
  LIFETIME,
  liveQuotes,
  openJob,
  postQuote,
  publishAgent,
  rateAgent,
  ratingsFor,
  receiptsForJob,
  recordDelivery,
  recordReceipt,
  SafeArkivWriter,
  SCHEMAS,
  setJobStatus,
  valuesFor,
} from "../src";
import { arkivTransport } from "../src/config";

const writerKey = process.env.ARKIV_WRITER_PRIVATE_KEY as Hex | undefined;
if (!writerKey || !process.env.ARKIV_ACCESS_KEY)
  throw new Error("run pnpm --filter @app/arkiv arkiv-setup first");
const platform = new SafeArkivWriter(writerKey);
const agentKey = generatePrivateKey();
const agent = new SafeArkivWriter(agentKey);
const r = arkivReader();
const ok = (msg: string, tx?: string) =>
  console.log(`✓ ${msg}${tx ? `  ${ARKIV_EXPLORER.tx(tx)}` : ""}`);
const task = `goa-trip-${Date.now().toString(36)}`;

// The new agent needs a little test GLM for its own writes: the platform sends it some.
const evm = createPublicClient({ chain: ARKIV_CHAIN, transport: arkivTransport() });
const fund = await createWalletClient({
  chain: ARKIV_CHAIN,
  transport: arkivTransport(),
  account: privateKeyToAccount(writerKey),
}).sendTransaction({ to: agent.address, value: parseEther("0.02") });
await evm.waitForTransactionReceipt({ hash: fund });
ok(`agent ${agent.address} funded`, fund);

const profile = await publishAgent(
  agent,
  {
    agent: agent.address,
    name: "StayWise",
    skill: "hotels",
    description: "Books hotels in India, pay on delivery.",
    endpoint: "https://staywise.example/x402",
    hederaAccount: "0.0.11329696",
  },
  [{ agent: agent.address, skill: "hotels", title: "Book a room", feeUnits: "20000" }],
);
ok("agent published its profile and a listing (one transaction)", profile.txHash);

const quote = await postQuote(
  agent,
  {
    agent: agent.address,
    task,
    skill: "hotels",
    feeUnits: "20000",
    summary: "Sea Breeze, Goa, 2 nights",
  },
  120,
);
ok(`agent quoted task ${task} (gone in 2 minutes)`, quote.txHash);

// Someone else writes a quote in StayWise's name: reads must ignore it.
const forged = await platform
  .run(1, (tx) =>
    platform.client.createEntity(
      SCHEMAS.quote,
      valuesFor("quote", {
        agent: agent.address,
        task,
        skill: "hotels",
        feeUnits: "1",
        summary: "forged",
      }),
      { expiration: LIFETIME.quote(120) },
      tx,
    ),
  )
  .catch(() => null);
if (forged) ok("a forged quote in StayWise's name was written by someone else", forged.txHash);

const job = await openJob(platform, {
  task,
  buyer: platform.address,
  seller: agent.address,
  quote: quote.entityKey,
  status: "paid",
  mandateId: "8",
});
ok("platform recorded the hire", job.txHash);
const receipt = await recordReceipt(platform, {
  job: job.entityKey,
  task,
  mandateId: "8",
  payer: "0.0.11328004",
  payTo: "0.0.11329685",
  amountUnits: "20000",
  hederaTx: "0.0.11328382@1793911194.459056253",
});
ok("platform recorded the receipt (points to the Hedera payment)", receipt.txHash);
const delivered = await recordDelivery(agent, {
  task,
  agent: agent.address,
  quote: quote.entityKey,
  status: "delivered",
});
ok("agent recorded its delivery", delivered.txHash);
ok(
  "platform marked the job delivered",
  (await setJobStatus(platform, job.entityKey, "delivered")).txHash,
);
ok(
  "platform rated the agent 5/5",
  (
    await rateAgent(platform, {
      agent: agent.address,
      job: job.entityKey,
      rater: platform.address,
      score: 5,
    })
  ).txHash,
);

// Read it all back (indexing can lag a block or two).
await new Promise((res) => setTimeout(res, 4000));
const agents = await findAgents(r, "hotels");
console.log(
  `  hotels agents: ${agents.some((a) => a.record.agent === agent.address) ? "StayWise found" : "missing"}`,
);
const quotes = await liveQuotes(r, task);
console.log(
  `  live quotes for ${task}: ${quotes.length} (${quotes.map((q) => q.record.summary).join(", ")})`,
);
const jobStatus = (await jobsForTask(r, task)).map((j) => j.record.status).join(", ");
console.log(`  jobs: ${jobStatus}`);
console.log(
  `  receipts from our writer: ${(await receiptsForJob(r, job.entityKey, platform.address)).length}`,
);
console.log(`  deliveries by StayWise: ${(await deliveriesBy(r, agent.address)).length}`);
const { average } = await ratingsFor(r, agent.address);
console.log(`  StayWise rating: ${average}`);
const forgedShown = quotes.some((q) => q.record.summary === "forged");
console.log(`${forgedShown ? "✗" : "✓"} the forged quote is ${forgedShown ? "SHOWN" : "ignored"}`);
console.log(`  entity: ${ARKIV_EXPLORER.entity(profile.profile)}`);
process.exit(forgedShown || quotes.length !== 1 || jobStatus !== "delivered" ? 1 : 0);
