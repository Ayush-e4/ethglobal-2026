import { z } from "zod";

/**
 * Duffel flights, **test mode only**: the token must start with `duffel_test_`, so orders are
 * made with test airlines (like Duffel Airways) and paid from Duffel's test balance; nobody is
 * charged and no seat is taken. Search (offer request) → re-check the offer → order → cancel.
 */
const BASE = "https://api.duffel.com";

const Place = z.object({ iata_code: z.string(), city_name: z.string().nullish() });
const Segment = z.object({
  departing_at: z.string(),
  arriving_at: z.string(),
  origin: Place,
  destination: Place,
  marketing_carrier: z.object({ name: z.string(), iata_code: z.string().nullish() }),
  marketing_carrier_flight_number: z.string().nullish(),
});
const Condition = z.object({ allowed: z.boolean() }).nullish();
const OfferRaw = z.object({
  id: z.string(),
  total_amount: z.string(),
  total_currency: z.string(),
  expires_at: z.string(),
  owner: z.object({ name: z.string(), iata_code: z.string().nullish() }),
  passengers: z.array(z.object({ id: z.string() })),
  slices: z.array(
    z.object({
      origin: Place,
      destination: Place,
      duration: z.string().nullish(),
      segments: z.array(Segment).min(1),
    }),
  ),
  conditions: z
    .object({ refund_before_departure: Condition, change_before_departure: Condition })
    .nullish(),
  total_emissions_kg: z.string().nullish(),
});
const OffersResponse = z.object({ data: z.object({ offers: z.array(OfferRaw) }) });
const OfferResponse = z.object({ data: OfferRaw });
const OrderResponse = z.object({
  data: z.object({ id: z.string(), booking_reference: z.string() }),
});
const CancellationResponse = z.object({
  data: z.object({
    id: z.string(),
    refund_amount: z.string().nullish(),
    refund_currency: z.string().nullish(),
  }),
});

export interface FlightLeg {
  from: string; // IATA
  to: string;
  fromCity?: string;
  toCity?: string;
  departAt: string; // local time at the airport, ISO without zone
  arriveAt: string;
  minutes: number;
  stops: number;
  flights: string[]; // "ZZ 1234"
}

export interface FlightOffer {
  offerId: string;
  airline: string;
  total: number;
  currency: string;
  expiresAt: string;
  passengerIds: string[];
  legs: FlightLeg[]; // one way: one; return: two
  refundable: boolean;
  changeable: boolean;
  emissionsKg?: number;
}

/** Test passengers only. Duffel needs the date of birth and gender for every flight. */
export interface Passenger {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  bornOn: string; // YYYY-MM-DD
  gender: "f" | "m";
}

/** "PT1H15M" → 75. */
export const isoMinutes = (d: string | null | undefined) => {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(d ?? "");
  return m ? Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
};
/** "+91 98000 00001" → "+919800000001"; ten digits with no country code are taken as India's. */
export const e164 = (phone: string) => {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  return digits.length === 10 ? `+91${digits}` : `+${digits}`;
};

function toOffer(o: z.infer<typeof OfferRaw>): FlightOffer {
  return {
    offerId: o.id,
    airline: o.owner.name,
    total: Number(o.total_amount),
    currency: o.total_currency,
    expiresAt: o.expires_at,
    passengerIds: o.passengers.map((p) => p.id),
    legs: o.slices.map((s) => {
      const first = s.segments[0] as z.infer<typeof Segment>;
      const last = s.segments.at(-1) as z.infer<typeof Segment>;
      return {
        from: s.origin.iata_code,
        to: s.destination.iata_code,
        fromCity: s.origin.city_name ?? undefined,
        toCity: s.destination.city_name ?? undefined,
        departAt: first.departing_at,
        arriveAt: last.arriving_at,
        minutes:
          isoMinutes(s.duration) ||
          Math.round((Date.parse(last.arriving_at) - Date.parse(first.departing_at)) / 60_000),
        stops: s.segments.length - 1,
        flights: s.segments.map((g) =>
          [g.marketing_carrier.iata_code, g.marketing_carrier_flight_number]
            .filter(Boolean)
            .join(" "),
        ),
      };
    }),
    refundable: !!o.conditions?.refund_before_departure?.allowed,
    changeable: !!o.conditions?.change_before_departure?.allowed,
    emissionsKg: o.total_emissions_kg ? Number(o.total_emissions_kg) : undefined,
  };
}

export class DuffelClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!token.startsWith("duffel_test_"))
      throw new Error("Duffel: test tokens only (duffel_test_…)");
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        "duffel-version": "v2",
        accept: "application/json",
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify({ data: body }),
      signal: AbortSignal.timeout(45_000),
    });
    const json = (await res.json().catch(() => null)) as {
      errors?: { message?: string; title?: string }[];
    } | null;
    if (!res.ok) {
      const e = json?.errors?.[0];
      throw new Error(
        `Duffel ${path.split("?")[0]}: ${res.status} ${e?.message ?? e?.title ?? ""}`.trim(),
      );
    }
    return json;
  }

  /** Economy offers for one adult, one way or return, at most one stop. */
  async search(q: {
    from: string;
    to: string;
    date: string;
    returnDate?: string;
  }): Promise<FlightOffer[]> {
    const slices = [{ origin: q.from, destination: q.to, departure_date: q.date }];
    if (q.returnDate)
      slices.push({ origin: q.to, destination: q.from, departure_date: q.returnDate });
    const json = await this.call(
      "POST",
      "/air/offer_requests?return_offers=true&supplier_timeout=20000",
      { slices, passengers: [{ type: "adult" }], cabin_class: "economy", max_connections: 1 },
    );
    return OffersResponse.parse(json).data.offers.map(toOffer);
  }

  /** The offer as it stands now (its price can change, or it can be gone). */
  async offer(offerId: string): Promise<FlightOffer> {
    return toOffer(OfferResponse.parse(await this.call("GET", `/air/offers/${offerId}`)).data);
  }

  /** Books it, paid from the test balance at the offer's current price. */
  async book(offerId: string, p: Passenger): Promise<{ orderId: string; bookingRef: string }> {
    const now = await this.offer(offerId);
    const [passengerId] = now.passengerIds;
    if (!passengerId) throw new Error("Duffel: the offer has no passenger");
    const json = await this.call("POST", "/air/orders", {
      type: "instant",
      selected_offers: [offerId],
      passengers: [
        {
          id: passengerId,
          title: p.gender === "f" ? "ms" : "mr",
          gender: p.gender,
          given_name: p.firstName,
          family_name: p.lastName,
          born_on: p.bornOn,
          email: p.email,
          phone_number: e164(p.phone),
        },
      ],
      payments: [{ type: "balance", amount: now.total.toFixed(2), currency: now.currency }],
    });
    const o = OrderResponse.parse(json).data;
    return { orderId: o.id, bookingRef: o.booking_reference };
  }

  /** Cancels an order: asks what comes back, then confirms. */
  async cancel(orderId: string): Promise<{ refund?: number; currency?: string }> {
    const c = CancellationResponse.parse(
      await this.call("POST", "/air/order_cancellations", { order_id: orderId }),
    ).data;
    await this.call("POST", `/air/order_cancellations/${c.id}/actions/confirm`);
    return {
      refund: c.refund_amount ? Number(c.refund_amount) : undefined,
      currency: c.refund_currency ?? undefined,
    };
  }
}
