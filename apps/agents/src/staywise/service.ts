import {
  arkivReader,
  findAgents,
  findListings,
  publishAgent,
  publishListings,
  SafeArkivWriter,
} from "@app/arkiv";
import { MandateClient, registryAddress } from "@app/mandates";
import { FormSchema } from "@app/shared";
import { LiteApiClient } from "@app/travel";
import { privateKeyToAccount } from "viem/accounts";
import { JsonStore } from "../store";
import { stayWiseApp } from "./app";
import type { StayWiseConfig } from "./config";
import { HOTEL_FORM } from "./form";
import type { Job, StoredQuote } from "./types";
import { StayWiseWorker } from "./worker";

/** Wires StayWise up: listed on Arkiv (once), jobs resumed after a restart, the API ready. */
export async function startStayWise(config: StayWiseConfig) {
  const agent = privateKeyToAccount(config.key);
  const arkiv = new SafeArkivWriter(config.key);
  const registry = new MandateClient(registryAddress());
  const lite = new LiteApiClient(config.liteApiKey);
  const quotes = new JsonStore<StoredQuote>(`${config.dataDir}/staywise-quotes.json`);
  const jobs = new JsonStore<Job>(`${config.dataDir}/staywise-jobs.json`);
  const worker = new StayWiseWorker({ registry, agent, lite, arkiv, jobs, quotes });

  // On the market once; a new listing only when our form changed (the newest one counts).
  const reader = arkivReader();
  const mine = (r: { creator: string }) => r.creator.toLowerCase() === agent.address.toLowerCase();
  const listed = (await findAgents(reader, "hotels")).some(mine);
  const listing = {
    agent: agent.address,
    skill: "hotels",
    title: "Book a room",
    feeUnits: "20000",
    input: HOTEL_FORM,
  };
  if (!listed) {
    await publishAgent(
      arkiv,
      {
        agent: agent.address,
        name: "StayWise",
        skill: "hotels",
        description:
          "Books hotel rooms in India. Firm prices, free cancellation, pay on delivery with an undo window.",
        endpoint: config.publicUrl,
        hederaAccount: config.accountId,
      },
      [listing],
    );
  } else {
    const newest = (await findListings(reader, "hotels"))
      .filter(mine)
      .sort((a, b) => Number(b.expiresAt - a.expiresAt))[0];
    // Compared as read back (the parser orders keys), so an unchanged form isn't republished.
    if (JSON.stringify(newest?.record.input) !== JSON.stringify(FormSchema.parse(HOTEL_FORM)))
      await publishListings(arkiv, [listing]);
  }
  worker.resume();
  return {
    app: stayWiseApp({ config, registry, lite, arkiv, quotes, jobs, worker }),
    agent,
    listed,
  };
}
