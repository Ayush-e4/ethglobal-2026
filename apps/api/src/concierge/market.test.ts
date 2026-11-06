import { describe, expect, it } from "vitest";
import { type MarketOffer, rankOffers } from "./market";

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
