import { arkivReader, ListingSchema, SafeArkivWriter } from "@app/arkiv";

import { MandateClient, registryAddress } from "@app/mandates";
import { parseUsdc } from "@app/shared";
import { DuffelClient } from "@app/travel";
import { privateKeyToAccount } from "viem/accounts";
import { agentIdentity } from "../identity";
import { cardIssuer } from "../jobs/cards";
import { JobWorker } from "../jobs/worker";
import { keepListed } from "../listing";
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
    cards: cardIssuer(config.cardsUrl, agent),
  });

  const reader = arkivReader();
  const listing = ListingSchema.parse({
    agent: agent.address,
    skill: "flights",
    title: config.title,
    feeUnits: parseUsdc(config.feeUsd.replace("$", "")).toString(),
    input: FLIGHT_FORM,
    service: config.service,
    guest: ["bornOn", "gender"], // an airline needs them; nobody else gets them
  });
  await keepListed(
    { arkiv, reader },
    {
      agent: agent.address,
      name: config.name,
      skill: "flights",
      description: config.description,
      endpoint: config.publicUrl,
      hederaAccount: config.accountId,
    },
    listing,
  );
  worker.resume();
  const identity = agentIdentity({ ...config, agent });
  void identity.ensure(); // ERC-8004 on Hedera: once, in the background
  const app = flightAgentApp({ config, registry, duffel, arkiv, quotes, jobs, worker });
  identity.routes(app);
  return { app, agent };
}
