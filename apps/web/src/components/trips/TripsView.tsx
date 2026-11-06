"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, type Trip } from "@/lib/api";
import { useEnter } from "@/lib/native/motion";
import { CardSkeleton } from "../Skeleton";
import { TripCard } from "./TripCard";

/** A trip is one chat: its flight and stay together, the newest trip first. */
function byTrip(trips: Trip[]) {
  const groups = new Map<string, { chatId: string; title: string; trips: Trip[] }>();
  for (const t of trips) {
    const g = groups.get(t.chatId) ?? { chatId: t.chatId, title: t.chatTitle, trips: [] };
    g.trips.push(t);
    groups.set(t.chatId, g);
  }
  return [...groups.values()];
}
const LIVE: Trip["status"][] = ["delivered", "released", "disputed"];
/** "2 bookings · 1 booked" */
function summary(trips: Trip[]) {
  const booked = trips.filter((t) => LIVE.includes(t.status) && !t.bookingCancelledAt).length;
  return `${trips.length} booking${trips.length === 1 ? "" : "s"}${booked ? ` · ${booked} booked` : ""}`;
}

/** Every booking you've made, grouped by trip (the chat it was planned in), newest first. */
export function TripsView() {
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Trip[]>("/trips")
      .then(setTrips)
      .catch(() => setError("Couldn't load your trips."));
  }, []);

  const scope = useRef<HTMLElement>(null);
  useEnter(scope, [trips === null], { once: "trips" });
  return (
    <main
      ref={scope}
      className="mx-auto flex w-full max-w-[800px] flex-col gap-6 px-4 pt-6 pb-14 sm:px-6 sm:pt-8"
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-[28px] font-bold tracking-tight sm:text-[32px]">Trips</h1>
        <p className="text-[15px] leading-relaxed text-ink-3">
          Everything agents booked for you. Each one has a receipt anyone can check: the fee's
          escrow on Hedera and the agent's signed offer on Arkiv.
        </p>
      </div>
      {!trips ? (
        error ? (
          <p className="p-10 text-center text-muted">{error}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <CardSkeleton label="Loading your trips" />
            <CardSkeleton label="Loading your trips" />
          </div>
        )
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
        byTrip(trips).map((g) => (
          <section key={g.chatId} aria-label={g.title} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[17px] font-bold">{g.title}</h2>
              <span className="text-xs text-muted">{summary(g.trips)}</span>
            </div>
            {g.trips.map((t) => (
              <div key={t.id} data-enter>
                <TripCard trip={t} />
              </div>
            ))}
          </section>
        ))
      )}
    </main>
  );
}
