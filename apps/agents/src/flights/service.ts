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
import { DuffelClient } from "@app/travel";
import { privateKeyToAccount } from "viem/accounts";
import { JobWorker } from "../jobs/worker";
import { JsonStore } from "../store";
import { flightAgentApp } from "./app";
import type { FlightAgentConfig } from "./config";
import { FLIGHT_FORM } from "./form";
import { flightSupplier } from "./supplier";
import type { FlightJob, FlightQuote } from "./types";

/** Wires SkyHop up: listed on Arkiv (again only when its listing changed), jobs resumed. */
export async function startFlightAgent(config: FlightAgentConfig) {
  const agent = privateKeyToAccount(config.key);
  const arkiv = new SafeArkivWriter(config.key);
  const registry = new MandateClient(registryAddress());
  const duffel = new DuffelClient(config.duffelToken);
  const quotes = new JsonStore<FlightQuote>(`${config.dataDir}/${config.id}-quotes.json`);
  const jobs = new JsonStore<FlightJob>(`${config.dataDir}/${config.id}-jobs.json`);
  const worker = new JobWorker<FlightQuote>({
    registry,
    agent,
    arkiv,
    jobs,
    quotes,
    supplier: flightSupplier(duffel),
  });

  const reader = arkivReader();
  const mine = (r: { creator: string }) => r.creator.toLowerCase() === agent.address.toLowerCase();
  const listed = (await findAgents(reader, "flights")).some(mine);
  const listing = ListingSchema.parse({
    agent: agent.address,
    skill: "flights",
    title: config.title,
    feeUnits: parseUsdc(config.feeUsd.replace("$", "")).toString(),
    input: FLIGHT_FORM,
    service: config.service,
  });
  if (!listed) {
    await publishAgent(
      arkiv,
      {
        agent: agent.address,
        name: config.name,
        skill: "flights",
        description: config.description,
        endpoint: config.publicUrl,
        hederaAccount: config.accountId,
      },
      [listing],
    );
  } else {
    const newest = (await findListings(reader, "flights"))
      .filter(mine)
      .sort((a, b) => Number(b.expiresAt - a.expiresAt))[0];
    if (JSON.stringify(newest?.record) !== JSON.stringify(listing))
      await publishListings(arkiv, [listing]);
  }
  worker.resume();
  return { app: flightAgentApp({ config, registry, duffel, arkiv, quotes, jobs, worker }), agent };
}
