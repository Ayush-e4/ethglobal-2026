import { arkivReader, findAgents, publishAgent, SafeArkivWriter } from "@app/arkiv";
import { MandateClient, registryAddress } from "@app/mandates";
import { LiteApiClient } from "@app/travel";
import { privateKeyToAccount } from "viem/accounts";
import { JsonStore } from "../store";
import { stayWiseApp } from "./app";
import type { StayWiseConfig } from "./config";
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

  const listed = (await findAgents(arkivReader(), "hotels")).some(
    (a) => a.creator.toLowerCase() === agent.address.toLowerCase(),
  );
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
      [{ agent: agent.address, skill: "hotels", title: "Book a room", feeUnits: "20000" }],
    );
  }
  worker.resume();
  return {
    app: stayWiseApp({ config, registry, lite, arkiv, quotes, jobs, worker }),
    agent,
    listed,
  };
}
