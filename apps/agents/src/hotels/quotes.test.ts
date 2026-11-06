import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HotelOffer } from "@app/travel";
import { describe, expect, it, vi } from "vitest";
import { JsonStore } from "../store";
import { makeQuotes, toOffer, topFacilities } from "./quotes";
import type { StoredQuote } from "./types";

const hotel = (id: string, total: number, score: number, stars = 4): HotelOffer => ({
  offerId: `o-${id}`,
  hotelId: id,
  hotelName: id,
  roomName: "Room",
  total,
  currency: "INR",
  score,
  stars,
  photo: `https://img.test/${id}.jpg`,
  area: "Candolim",
});

function setup(offers: HotelOffer[], soldOut: string[] = []) {
  const lite = {
    findPlace: vi.fn(async () => "place-1"),
    searchHotels: vi.fn(async () => offers),
    prebook: vi.fn(async (id: string) => {
      if (soldOut.includes(id)) throw new Error("LiteAPI /v3.0/rates/prebook: HTTP 409");
      const o = offers.find((x) => x.offerId === id);
      return {
        prebookId: `p-${id}`,
        total: (o?.total ?? 0) + 100,
        currency: "INR",
        refundable: true,
      };
    }),
    hotelDetails: vi.fn(async (id: string) => ({
      images: [`https://img.test/${id}.jpg`, `https://img.test/${id}-2.jpg`],
      facilities: ["Lift", "Swimming pool", "Free WiFi", "Spa"],
    })),
  };
  const arkiv = {
    address: "0x00000000000000000000000000000000000000a1",
    run: vi.fn(async (n: number) => ({
      txHash: "0x1",
      createdEntities: Array.from({ length: n }, (_, i) => `0x${String(i + 1).padStart(64, "0")}`),
    })),
  };
  const quotes = new JsonStore<StoredQuote>(join(mkdtempSync(join(tmpdir(), "q-")), "q.json"));
  const run = (extra: Record<string, unknown> = {}) =>
    makeQuotes({ lite, arkiv, quotes, feeUsd: "$0.02" } as never, {
      task: "t1",
      iataCode: "GOI",
      checkin: "2026-12-06",
      checkout: "2026-12-08",
      adults: 2,
      ...extra,
    });
  return { lite, arkiv, run };
}

const FIVE = [
  hotel("budget", 5000, 7.1, 3),
  hotel("solid", 7000, 8.6),
  hotel("value", 8000, 9.0),
  hotel("luxury", 25000, 9.6, 5),
  hotel("pricey", 30000, 8.0, 5),
];

describe("makeQuotes", () => {
  it("three different hotels, each for a reason, signed on Arkiv in one transaction", async () => {
    const { run, arkiv } = setup(FIVE);
    const qs = await run();
    expect(qs.map((q) => [q.tag, q.hotelName])).toEqual([
      ["Cheapest", "budget"],
      ["Best rated", "luxury"],
      ["Best value", "solid"], // 8.6 for 7,000 beats 9.0 for 8,000
    ]);
    expect(arkiv.run).toHaveBeenCalledTimes(1);
    expect(qs[0]).toMatchObject({ prebookId: "p-o-budget", total: 5100, feeUnits: "20000" });
    expect(qs[0]?.photos).toEqual(["https://img.test/budget.jpg", "https://img.test/budget-2.jpg"]);
  });

  it("a sold-out rate gives its place to the next hotel, and the labels stay true", async () => {
    const { run, arkiv } = setup(FIVE, ["o-budget"]);
    const qs = await run();
    expect(qs.map((q) => [q.tag, q.hotelName])).toEqual([
      ["Cheapest", "solid"],
      ["Best rated", "luxury"],
      ["Best value", "value"],
    ]);
    // One Arkiv batch of three quotes, its keys in the order shown.
    const batch = arkiv.run.mock.calls[0] as unknown as [number];
    expect(batch[0]).toBe(3);
    expect(qs.map((q) => q.key)).toEqual([1, 2, 3].map((i) => `0x${String(i).padStart(64, "0")}`));
  });

  it("keeps to the budget and the stars, and searches around an area", async () => {
    const { run, lite } = setup(FIVE);
    const qs = await run({ maxTotal: 9000, minStars: 4, area: "Baga Beach, Goa" });
    expect(qs.map((q) => q.hotelName).sort()).toEqual(["solid", "value"]);
    expect(lite.findPlace).toHaveBeenCalledWith("Baga Beach, Goa");
    expect(lite.searchHotels).toHaveBeenCalledWith(expect.objectContaining({ placeId: "place-1" }));
  });
});

describe("what the buyer sees", () => {
  it("the best facilities first", () => {
    expect(topFacilities(["Lift", "Free WiFi", "Swimming pool", "Pool bar", "Spa"])).toEqual([
      "Pool",
      "Spa",
      "Free WiFi",
    ]);
    expect(topFacilities(["Parking space", "Pool hoist on site", "Gym"])).toEqual(["Pool", "Gym"]);
  });

  it("an offer has the hotel at a glance, never the prebook id", async () => {
    const [q] = await setup(FIVE).run();
    const o = toOffer(q as StoredQuote);
    expect(o).toMatchObject({
      title: "budget",
      tag: "Cheapest",
      rating: { stars: 3, score: 7.1 },
      location: "Candolim",
      details: ["2 nights, 2 adults", "Pool", "Spa", "Free WiFi"],
    });
    expect(JSON.stringify(o)).not.toContain("p-o-budget");
  });
});
