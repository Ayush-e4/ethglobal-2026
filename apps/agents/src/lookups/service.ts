import { arkivReader, ListingSchema, SafeArkivWriter } from "@app/arkiv";
import { parseUsdc } from "@app/shared";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { agentIdentity } from "../identity";
import { lookupRoutes } from "../jobs/lookup-routes";
import { keepListed } from "../listing";
import { BANKCHECK_FORM, ifscAnswer, type loadBankCheckConfig } from "./bankcheck";

/** Wires Bank Check up: listed on Arkiv as a lookup agent, its ERC-8004 identity, GET /answer. */
export async function startBankCheck(config: ReturnType<typeof loadBankCheckConfig>) {
  const agent = privateKeyToAccount(config.key);
  const arkiv = new SafeArkivWriter(config.key);
  const listing = ListingSchema.parse({
    agent: agent.address,
    skill: config.skill,
    title: config.title,
    feeUnits: parseUsdc(config.feeUsd.replace("$", "")).toString(),
    input: BANKCHECK_FORM,
    service: config.service,
    kind: "lookup",
  });
  await keepListed(
    { arkiv, reader: arkivReader() },
    {
      agent: agent.address,
      name: config.name,
      skill: config.skill,
      description: config.description,
      endpoint: config.publicUrl,
      hederaAccount: config.accountId,
    },
    listing,
  );
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true, agent: agent.address }));
  lookupRoutes(app, {
    feeUsd: config.feeUsd,
    accountId: config.accountId,
    facilitatorUrl: config.facilitatorUrl,
    form: BANKCHECK_FORM,
    what: "Look up an IFSC code.",
    answer: (v) => ifscAnswer(String(v.ifsc)),
  });
  const identity = agentIdentity({ ...config, agent });
  void identity.ensure(); // ERC-8004 on Hedera: once, in the background
  identity.routes(app);
  return { app, agent };
}
