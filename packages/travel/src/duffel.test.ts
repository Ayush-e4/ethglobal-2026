import { describe, expect, it } from "vitest";
import { DuffelClient, e164, isoMinutes } from "./duffel";

const offer = (id: string, amount: string, over: Record<string, unknown> = {}) => ({
  id,
  total_amount: amount,
  total_currency: "GBP",
  expires_at: "2026-12-01T10:00:00Z",
  owner: { name: "Duffel Airways", iata_code: "ZZ" },
  passengers: [{ id: "pas_1" }],
  slices: [
    {
      origin: { iata_code: "BOM", city_name: "Mumbai" },
      destination: { iata_code: "GOI", city_name: "Goa" },
      duration: "PT1H8M",
      segments: [
        {
          departing_at: "2026-12-20T14:42:00",
          arriving_at: "2026-12-20T15:50:00",
          origin: { iata_code: "BOM" },
          destination: { iata_code: "GOI" },
          marketing_carrier: { name: "Duffel Airways", iata_code: "ZZ" },
          marketing_carrier_flight_number: "5009",
        },
      ],
    },
  ],
  conditions: { refund_before_departure: null, change_before_departure: { allowed: true } },
  total_emissions_kg: "120",
  ...over,
});

function fake(routes: Record<string, unknown>) {
  const calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[] =
    [];
  const f = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://api.duffel.com", "");
    calls.push({
      method: init.method ?? "GET",
      path,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
      headers: init.headers as Record<string, string>,
    });
    const key = Object.keys(routes).find((k) => path.startsWith(k));
    return key
      ? Response.json(routes[key])
      : Response.json({ errors: [{ message: "nope" }] }, { status: 422 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("Duffel (test mode)", () => {
  it("only takes test tokens", () => {
    expect(() => new DuffelClient("duffel_live_x")).toThrow(/test tokens only/);
  });

  it("searches one adult, economy, and reads the offers", async () => {
    const { f, calls } = fake({
      "/air/offer_requests": { data: { offers: [offer("off_1", "45.39")] } },
    });
    const [o] = await new DuffelClient("duffel_test_x", f).search({
      from: "BOM",
      to: "GOI",
      date: "2026-12-20",
      returnDate: "2026-12-22",
    });
    expect(calls[0]?.headers["duffel-version"]).toBe("v2");
    expect(calls[0]?.body).toMatchObject({
      data: {
        passengers: [{ type: "adult" }],
        cabin_class: "economy",
        slices: [
          { origin: "BOM", destination: "GOI", departure_date: "2026-12-20" },
          { origin: "GOI", destination: "BOM", departure_date: "2026-12-22" },
        ],
      },
    });
    expect(o).toMatchObject({
      offerId: "off_1",
      airline: "Duffel Airways",
      total: 45.39,
      currency: "GBP",
      refundable: false,
      changeable: true,
      legs: [{ from: "BOM", to: "GOI", minutes: 68, stops: 0, flights: ["ZZ 5009"] }],
    });
  });

  it("books at the offer's current price, with the passenger as Duffel needs them", async () => {
    const { f, calls } = fake({
      "/air/offers/off_1": { data: offer("off_1", "46.00") },
      "/air/orders": { data: { id: "ord_1", booking_reference: "RZPNX8" } },
    });
    const r = await new DuffelClient("duffel_test_x", f).book("off_1", {
      firstName: "Asha",
      lastName: "Test",
      email: "asha.test@example.com",
      phone: "+91 98000 00001",
      bornOn: "1990-05-14",
      gender: "f",
    });
    expect(r).toEqual({ orderId: "ord_1", bookingRef: "RZPNX8" });
    expect(calls[1]?.body).toMatchObject({
      data: {
        type: "instant",
        selected_offers: ["off_1"],
        passengers: [
          {
            id: "pas_1",
            title: "ms",
            gender: "f",
            given_name: "Asha",
            born_on: "1990-05-14",
            phone_number: "+919800000001",
          },
        ],
        payments: [{ type: "balance", amount: "46.00", currency: "GBP" }],
      },
    });
  });

  it("cancels: asks, then confirms", async () => {
    const { f, calls } = fake({
      "/air/order_cancellations/oca_1/actions/confirm": { data: { id: "oca_1" } },
      "/air/order_cancellations": {
        data: { id: "oca_1", refund_amount: "40.00", refund_currency: "GBP" },
      },
    });
    expect(await new DuffelClient("duffel_test_x", f).cancel("ord_1")).toEqual({
      refund: 40,
      currency: "GBP",
    });
    expect(calls.map((c) => c.path)).toEqual([
      "/air/order_cancellations",
      "/air/order_cancellations/oca_1/actions/confirm",
    ]);
  });

  it("says what Duffel refused", async () => {
    const { f } = fake({});
    await expect(new DuffelClient("duffel_test_x", f).offer("off_9")).rejects.toThrow(
      /Duffel \/air\/offers\/off_9: 422 nope/,
    );
  });

  it("reads durations and phone numbers", () => {
    expect(isoMinutes("PT1H8M")).toBe(68);
    expect(isoMinutes("P1DT2H")).toBe(1560);
    expect(e164("98000 00001")).toBe("+919800000001");
    expect(e164("+44 20 7946 0000")).toBe("+442079460000");
  });
});
