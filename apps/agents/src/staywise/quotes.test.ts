import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { JsonStore } from "../store";
import { makeQuote } from "./quotes";
import type { StoredQuote } from "./types";

describe("makeQuote", () => {
  it("falls through to the next room when a rate sold out (409 on prebook)", async () => {
    const offers = [
      {
        offerId: "o1",
        hotelId: "h1",
        hotelName: "Gone Inn",
        roomName: "A",
        total: 5000,
        currency: "INR",
      },
      {
        offerId: "o2",
        hotelId: "h2",
        hotelName: "Park Inn",
        roomName: "B",
        total: 6000,
        currency: "INR",
      },
    ];
    const lite = {
      searchHotels: vi.fn(async () => offers),
      prebook: vi.fn(async (id: string) => {
        if (id === "o1") throw new Error("LiteAPI /v3.0/rates/prebook: HTTP 409");
        return { prebookId: "p2", total: 6100, currency: "INR", refundable: true };
      }),
    };
    const arkiv = {
      address: "0x00000000000000000000000000000000000000a1",
      run: vi.fn(async () => ({ txHash: "0x1", entityKey: `0x${"ab".repeat(32)}` })),
    };
    const quotes = new JsonStore<StoredQuote>(join(mkdtempSync(join(tmpdir(), "q-")), "q.json"));
    const q = await makeQuote({ lite, arkiv, quotes, feeUsd: "$0.02" } as never, {
      task: "t1",
      iataCode: "GOI",
      checkin: "2026-12-06",
      checkout: "2026-12-08",
      adults: 2,
    });
    expect(q).toMatchObject({
      hotelName: "Park Inn",
      prebookId: "p2",
      total: 6100,
      feeUnits: "20000",
    });
  });
});
