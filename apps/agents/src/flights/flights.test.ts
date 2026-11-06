import type { FlightOffer } from "@app/travel";
import { describe, expect, it, vi } from "vitest";
import { inrRates } from "./fx";
import { pickThree, toFlightOffer } from "./quotes";
import { flightSupplier, passengerProblem } from "./supplier";
import type { FlightQuote } from "./types";

const leg = (flight: string, minutes: number, stops = 0) => ({
  from: "BOM",
  to: "GOI",
  departAt: "2026-12-20T14:42:00",
  arriveAt: "2026-12-20T15:50:00",
  minutes,
  stops,
  flights: [flight],
});
const offer = (id: string, total: number, o: Partial<FlightOffer> = {}): FlightOffer => ({
  offerId: id,
  airline: "Air India",
  total,
  currency: "GBP",
  expiresAt: "2026-12-01T10:00:00Z",
  passengerIds: ["pas_1"],
  legs: [leg(`AI ${id}`, 75)],
  refundable: false,
  changeable: false,
  ...o,
});
const ASHA = {
  firstName: "Asha",
  lastName: "Test",
  email: "a@example.com",
  phone: "+91 98000 00001",
};

describe("SkyHop", () => {
  it("offers three different flights: the cheapest, the fastest, the most flexible", () => {
    const picked = pickThree([
      offer("1", 40, { legs: [leg("AI 1", 190, 1)] }),
      offer("1b", 40, { legs: [leg("AI 1", 190, 1)] }), // the same flight at the same price
      offer("2", 60, { legs: [leg("AI 2", 65)] }),
      offer("3", 80, { changeable: true }),
      offer("4", 90, { refundable: true, changeable: true }),
    ]);
    expect(picked.map((p) => [p.tag, p.offer.offerId])).toEqual([
      ["Cheapest", "1"],
      ["Fastest", "2"],
      ["Most flexible", "4"],
    ]);
  });

  it("when nothing is flexible, the third is another time, not a false 'most flexible'", () => {
    const later = (id: string, total: number) =>
      offer(id, total, { legs: [{ ...leg(`AI ${id}`, 75), departAt: "2026-12-20T21:20:00" }] });
    const picked = pickThree([offer("1", 40), offer("2", 45), later("3", 70), later("4", 60)]);
    expect(picked.map((p) => [p.tag, p.offer.offerId])).toEqual([
      ["Cheapest", "1"],
      ["Fastest", "2"],
      ["Another time", "4"],
    ]);
  });

  it("shows a flight as the market's offer", () => {
    const o = toFlightOffer({
      key: `0x${"ab".repeat(32)}`,
      task: "goa",
      offerId: "off_1",
      airline: "Air India",
      legs: [leg("AI 2505", 75), { ...leg("AI 2506", 70), departAt: "2026-12-22T10:00:00" }],
      total: 78.57,
      currency: "GBP",
      refundable: false,
      changeable: true,
      emissionsKg: 21,
      feeUnits: "30000",
      expiresAtMs: 0,
      tag: "Cheapest",
    } as FlightQuote);
    expect(o).toMatchObject({
      title: "Air India",
      summary: "Air India · BOM → GOI and back · 20 Dec–22 Dec",
      subtitle: "BOM → GOI and back · 20 Dec 14:42 → 15:50 · 1h 15m nonstop · AI 2505",
      price: { amount: 78.57, currency: "GBP" },
    });
    expect(o.details).toContain("Changes allowed");
  });

  it("shows the fare in rupees at today's rate, and says what it's charged in", () => {
    const o = toFlightOffer({
      key: `0x${"ab".repeat(32)}`,
      airline: "Air India",
      legs: [leg("AI 2505", 75)],
      total: 45,
      currency: "GBP",
      inr: 5724,
      changeable: false,
      tag: "Cheapest",
    } as FlightQuote);
    expect(o.price).toEqual({ amount: 5724, currency: "INR" });
    expect(o.details).toContain("Fare GBP 45.00, about ₹5,724 today");
  });

  it("keeps today's rate for a while, and shows the fare as it is without one", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ result: "success", rates: { INR: 127.2 } }),
    );
    const rate = inrRates(fetchImpl as never);
    expect(await rate("GBP")).toBe(127.2);
    expect(await rate("GBP")).toBe(127.2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await rate("INR")).toBe(1);
    const down = inrRates((async () => {
      throw new Error("offline");
    }) as never);
    expect(await down("GBP")).toBeNull();
  });

  it("asks for the date of birth and gender before anything is paid", () => {
    expect(passengerProblem(ASHA)).toMatch(/date of birth and gender/);
    expect(passengerProblem({ ...ASHA, bornOn: "1990-05-14", gender: "f" })).toBeNull();
  });

  it("books at the quoted fare, gives the airline's code, and won't book if it went up", async () => {
    const duffel = {
      offer: vi.fn(async () => offer("off_1", 46)),
      book: vi.fn(async () => ({ orderId: "ord_1", bookingRef: "RZPNX8" })),
      cancel: vi.fn(),
    };
    const s = flightSupplier(duffel as never);
    const g = { ...ASHA, bornOn: "1990-05-14", gender: "f" as const };
    const q = { offerId: "off_1", total: 45.39 } as FlightQuote;
    expect(await s.book(q, g, "ref")).toEqual({ bookingId: "ord_1", reference: "RZPNX8" });
    await expect(s.book({ ...q, total: 40 }, g, "ref")).rejects.toThrow(/fare went up/);
    expect(duffel.book).toHaveBeenCalledTimes(1);
  });
});
