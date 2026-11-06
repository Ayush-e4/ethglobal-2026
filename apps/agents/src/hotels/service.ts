import {
  arkivReader,
  findAgents,
  findListings,
  ListingSchema,
  publishAgent,
  publishListings,
  SafeArkivWriter,
} from "@app/arkiv";
import { MandateClient, registryAddress } from "@app/mandates";
import { parseUsdc } from "@app/shared";
import { LiteApiClient } from "@app/travel";
import { privateKeyToAccount } from "viem/accounts";
import { JsonStore } from "../store";
import { hotelAgentApp } from "./app";
import type { HotelAgentConfig } from "./config";
import { HOTEL_FORM } from "./form";
import type { Job, StoredQuote } from "./types";
import { PriceWatcher } from "./watch";
import { HotelWorker } from "./worker";

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
  const worker = new HotelWorker({
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
  const mine = (r: { creator: string }) => r.creator.toLowerCase() === agent.address.toLowerCase();
  const listed = (await findAgents(reader, "hotels")).some(mine);
  const listing = ListingSchema.parse({
    agent: agent.address,
    skill: "hotels",
    title: config.title,
    feeUnits: parseUsdc(config.feeUsd.replace("$", "")).toString(),
    input: HOTEL_FORM,
    service: config.service,
  });
  if (!listed) {
    await publishAgent(
      arkiv,
      {
        agent: agent.address,
        name: config.name,
        skill: "hotels",
        description: config.description,
        endpoint: config.publicUrl,
        hederaAccount: config.accountId,
      },
      [listing],
    );
  } else {
    const newest = (await findListings(reader, "hotels"))
      .filter(mine)
      .sort((a, b) => Number(b.expiresAt - a.expiresAt))[0];
    // Both as the parser returns them (it orders keys), so an unchanged listing isn't republished.
    if (JSON.stringify(newest?.record) !== JSON.stringify(listing))
      await publishListings(arkiv, [listing]);
  }
  worker.resume();
  watcher?.start();
  return {
    app: hotelAgentApp({ config, registry, lite, arkiv, quotes, jobs, worker, watcher }),
    agent,
    listed,
  };
}
