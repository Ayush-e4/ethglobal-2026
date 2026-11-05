import { describe, expect, it } from "vitest";
import { LiteApiClient } from "./liteapi";

const reply =
  (body: unknown, status = 200) =>
  async () =>
    Response.json(body, { status });

describe("LiteApiClient", () => {
  it("refuses anything but a sandbox key", () => {
    expect(() => new LiteApiClient("prod_123")).toThrow("sandbox keys only");
  });

  it("returns the cheapest offer per hotel, cheapest first", async () => {
    const api = new LiteApiClient(
      "sand_x",
      reply({
        data: [
          {
            hotelId: "h1",
            roomTypes: [
              {
                offerId: "o1",
                offerRetailRate: { amount: 9000, currency: "INR" },
                rates: [{ name: "Deluxe" }],
              },
            ],
          },
          {
            hotelId: "h2",
            roomTypes: [{ offerId: "o2", offerRetailRate: [{ amount: 6000, currency: "INR" }] }],
          },
        ],
        hotels: [
          { id: "h1", name: "Sea Breeze" },
          { id: "h2", name: "Palm Grove" },
        ],
      }),
    );
    const offers = await api.searchHotels({
      iataCode: "GOI",
      checkin: "2026-12-06",
      checkout: "2026-12-08",
      adults: 2,
    });
    expect(offers.map((o) => [o.hotelName, o.total])).toEqual([
      ["Palm Grove", 6000],
      ["Sea Breeze", 9000],
    ]);
  });

  it("treats 'no availability' as no offers", async () => {
    const api = new LiteApiClient(
      "sand_x",
      reply({ error: { code: 2001, message: "no availability" } }),
    );
    expect(
      await api.searchHotels({ iataCode: "GOI", checkin: "a", checkout: "b", adults: 1 }),
    ).toEqual([]);
  });

  it("reads the prebook's locked price and cancellation tag", async () => {
    const api = new LiteApiClient(
      "sand_x",
      reply({
        data: {
          prebookId: "p1",
          price: 6100,
          currency: "INR",
          roomTypes: [{ rates: [{ cancellationPolicies: { refundableTag: "RFN" } }] }],
        },
      }),
    );
    expect(await api.prebook("o2")).toEqual({
      prebookId: "p1",
      total: 6100,
      currency: "INR",
      refundable: true,
    });
  });

  it("doesn't leak response bodies in errors", async () => {
    const api = new LiteApiClient(
      "sand_x",
      async () => new Response("secret stuff", { status: 500 }),
    );
    await expect(api.prebook("o")).rejects.toThrow("LiteAPI /v3.0/rates/prebook: HTTP 500");
  });
});
