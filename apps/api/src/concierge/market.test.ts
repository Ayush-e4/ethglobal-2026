import { describe, expect, it } from "vitest";
import {
  type MarketAgent,
  type MarketOffer,
  matchScore,
  rankAgents,
  rankOffers,
  ratingScore,
} from "./market";

const offer = (title: string, amount: number | null, feeUnits = "20000") =>
  ({
    key: `0x${"ab".repeat(32)}`,
    title,
    summary: title,
    feeUnits,
    price: amount === null ? undefined : { amount, currency: "INR" },
    agent: {} as MarketOffer["agent"],
  }) as MarketOffer;

describe("rankOffers", () => {
  it("cheapest first, then the lower fee; offers without a price last", () => {
    const ranked = rankOffers([
      offer("no price", null),
      offer("dear", 15000),
      offer("cheap, dearer fee", 9000, "30000"),
      offer("cheap", 9000, "10000"),
    ]);
    expect(ranked.map((o) => o.title)).toEqual(["cheap", "cheap, dearer fee", "dear", "no price"]);
  });
});

const agent = (name: string, over: Partial<MarketAgent> = {}): MarketAgent => ({
  name,
  skill: "hotels",
  description: "",
  agent: "0x00000000000000000000000000000000000000a1",
  endpoint: "http://x",
  feeUnits: "20000",
  delivered: 0,
  ...over,
});

describe("finding agents by need", () => {
  it("matches the skill first, then the listing and how the agent works", () => {
    const stay = agent("StayWise", {
      title: "Book a room",
      service: { model: "Book it, done", promise: "Cheapest rooms" },
    });
    const guard = agent("PriceGuard", {
      service: { model: "Book and keep watching", promise: "I watch the price and rebook cheaper" },
    });
    const fly = agent("SkyHop", { skill: "flights", description: "Books flights" });
    const need = "a hotel room in Goa, and keep watching the price";
    expect(matchScore(stay, need)).toBeGreaterThan(matchScore(fly, need));
    expect(matchScore(guard, need)).toBeGreaterThan(matchScore(stay, need));
    expect(matchScore(fly, "cheap flights to Delhi")).toBeGreaterThan(0);
    expect(matchScore(stay, "cheap flights to Delhi")).toBe(0);
  });

  it("asks the most reliable agents first, then the cheaper", () => {
    const ranked = rankAgents([
      agent("new", { delivered: 0, feeUnits: "10000" }),
      agent("proven", { delivered: 12, feeUnits: "50000" }),
      agent("proven, cheaper", { delivered: 12, feeUnits: "20000" }),
    ]);
    expect(ranked.map((a) => a.name)).toEqual(["proven, cheaper", "proven", "new"]);
  });

  it("verified people's ratings come first, and one 5-star rating can't beat many good ones", () => {
    const ranked = rankAgents([
      agent("unrated, busy", { delivered: 30 }),
      agent("one rave", { rating: { average: 5, count: 1 } }),
      agent("loved by many", { rating: { average: 4.6, count: 10 } }),
      agent("panned", { delivered: 50, rating: { average: 1.5, count: 4 } }),
    ]);
    expect(ranked.map((a) => a.name)).toEqual([
      "loved by many",
      "one rave",
      "unrated, busy",
      "panned",
    ]);
    expect(ratingScore({ average: 5, count: 1 })).toBeCloseTo(3.67, 2);
    expect(ratingScore(undefined)).toBe(3);
  });
});
