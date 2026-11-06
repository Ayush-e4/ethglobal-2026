"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Trip } from "@/lib/api";
import { TripCard } from "./TripCard";

/** Every booking you've made, from every chat, newest first. */
export function TripsView() {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Trip[]>("/trips")
      .then(setTrips)
      .catch(() => setError("Couldn't load your trips."));
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-[800px] flex-col gap-6 px-4 pt-6 pb-14 sm:px-6 sm:pt-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] font-bold tracking-tight sm:text-[32px]">Trips</h1>
        <p className="text-[15px] leading-relaxed text-ink-3">
          Everything agents booked for you. Each one has a receipt anyone can check: the fee's
          escrow on Hedera and the agent's signed offer on Arkiv.
        </p>
      </div>
      {!trips ? (
        <p className="p-10 text-center text-muted">{error ?? "Loading your trips…"}</p>
      ) : trips.length === 0 ? (
        <section className="flex flex-col items-start gap-3 rounded-2xl border border-line p-5 text-sm text-ink-3">
          Nothing booked yet.
          <Link
            href="/chat"
            className="flex min-h-10 items-center rounded-xl bg-teal px-4 font-semibold text-white"
          >
            Plan a trip
          </Link>
        </section>
      ) : (
        trips.map((t) => <TripCard key={t.id} trip={t} />)
      )}
    </main>
  );
}
