import { arkivReader, ListingSchema, SafeArkivWriter } from "@app/arkiv";

import { MandateClient, registryAddress } from "@app/mandates";
import { parseUsdc } from "@app/shared";
import { LiteApiClient } from "@app/travel";
import { privateKeyToAccount } from "viem/accounts";
import { agentIdentity } from "../identity";
import { cardIssuer } from "../jobs/cards";
import { keepListed } from "../listing";
import { JsonStore } from "../store";
import { hotelAgentApp } from "./app";
import type { HotelAgentConfig } from "./config";
import { HOTEL_FORM } from "./form";
import type { Job, StoredQuote } from "./types";
import { PriceWatcher } from "./watch";
import { hotelWorker } from "./worker";

/**
 * Wires a hotel agent up: listed on Arkiv (a new listing only when what it says changed), jobs
 * resumed after a restart, its price watcher started if it watches, the API ready.
 */
export async function startHotelAgent(config: HotelAgentConfig) {
  const agent = privateKeyToAccount(config.key);
  const arkiv = new SafeArkivWriter(config.key);
  const registry = new MandateClient(registryAddress());
  const lite = new LiteApiClient(config.liteApiKey);
  const quotes = new JsonStore<StoredQuote>(`${config.dataDir}/${config.id}-quotes.json`);
  const jobs = new JsonStore<Job>(`${config.dataDir}/${config.id}-jobs.json`);
  const worker = hotelWorker({
    cards: cardIssuer(config.cardsUrl, agent),
    registry,
    agent,
    lite,
    arkiv,
    jobs,
    quotes,
    watches: config.watches,
  });
  const watcher = config.watches
    ? new PriceWatcher({ lite, jobs, quotes, everyMs: config.watchEveryMs })
    : null;

  const reader = arkivReader();
  const listing = ListingSchema.parse({
    agent: agent.address,
    skill: "hotels",
    title: config.title,
    feeUnits: parseUsdc(config.feeUsd.replace("$", "")).toString(),
    input: HOTEL_FORM,
    service: config.service,
  });
  const listed = await keepListed(
    { arkiv, reader },
    {
      agent: agent.address,
      name: config.name,
      skill: "hotels",
      description: config.description,
      endpoint: config.publicUrl,
      hederaAccount: config.accountId,
    },
    listing,
  );
  worker.resume();
  watcher?.start();
  const identity = agentIdentity({ ...config, agent });
  void identity.ensure(); // ERC-8004 on Hedera: once, in the background
  const app = hotelAgentApp({ config, registry, lite, arkiv, quotes, jobs, worker, watcher });
  identity.routes(app);
  return {
    app,
    agent,
    listed,
  };
}
