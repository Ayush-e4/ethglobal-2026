import { z } from "zod";

/**
 * LiteAPI hotels, **sandbox only**: the key must start with `sand_`, and sandbox bookings paid
 * with ACC_CREDIT_CARD are simulated, so nobody is charged and no hotel is told.
 * Search → prebook (checks availability and locks the price) → book.
 */
const API = "https://api.liteapi.travel/v3.0";
const BOOK = "https://book.liteapi.travel/v3.0";

const Money = z.object({ amount: z.number(), currency: z.string() });
const RatesResponse = z.object({
  // "No availability" is HTTP 200 with { error: { code: 2001 } }.
  error: z.object({ code: z.number(), message: z.string().optional() }).optional(),
  data: z
    .array(
      z.object({
        hotelId: z.string(),
        roomTypes: z.array(
          z.object({
            offerId: z.string(),
            name: z.string().optional(),
            offerRetailRate: z.union([Money, z.array(Money)]).optional(),
            rates: z
              .array(z.object({ name: z.string(), boardName: z.string().optional() }))
              .optional(),
          }),
        ),
      }),
    )
    .default([]),
  hotels: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
});
const PrebookResponse = z.object({
  data: z.object({
    prebookId: z.string(),
    price: z.number(),
    currency: z.string(),
    roomTypes: z
      .array(
        z.object({
          rates: z.array(
            z.object({
              cancellationPolicies: z.object({ refundableTag: z.string().optional() }).optional(),
            }),
          ),
        }),
      )
      .optional(),
  }),
});
const BookResponse = z.object({
  data: z.object({
    bookingId: z.string(),
    status: z.string(),
    hotelConfirmationCode: z.string().nullish(),
    hotel: z.object({ name: z.string() }).partial().optional(),
    price: z.number().optional(),
    currency: z.string().optional(),
  }),
});

export interface HotelOffer {
  offerId: string;
  hotelId: string;
  hotelName: string;
  roomName: string;
  board?: string;
  total: number;
  currency: string;
}

export interface HotelPrebook {
  prebookId: string;
  total: number;
  currency: string;
  refundable?: boolean;
}

/** Test travellers only: never a real person's details. */
export interface HotelGuest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface HotelBooking {
  bookingId: string;
  status: string;
  confirmationCode?: string;
  hotelName?: string;
  total?: number;
  currency?: string;
}

export class LiteApiClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!apiKey.startsWith("sand_")) throw new Error("LiteAPI: sandbox keys only (sand_…)");
  }

  private async post(url: string, body: unknown): Promise<unknown> {
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": this.apiKey },
      body: JSON.stringify(body),
    });
    // Sanitized: never echo the key or the full response into logs.
    if (!res.ok) throw new Error(`LiteAPI ${new URL(url).pathname}: HTTP ${res.status}`);
    return res.json();
  }

  /** Hotels near an airport (IATA code), cheapest offer per hotel, cheapest first. */
  async searchHotels(q: {
    iataCode: string;
    checkin: string; // YYYY-MM-DD
    checkout: string;
    adults: number;
    refundableOnly?: boolean;
    limit?: number;
  }): Promise<HotelOffer[]> {
    const json = await this.post(`${API}/hotels/rates`, {
      iataCode: q.iataCode,
      checkin: q.checkin,
      checkout: q.checkout,
      occupancies: [{ adults: q.adults }],
      currency: "INR",
      guestNationality: "IN",
      maxRatesPerHotel: 1,
      includeHotelData: true,
      ...(q.refundableOnly ? { refundableRatesOnly: true } : {}),
      limit: q.limit ?? 20,
    });
    const parsed = RatesResponse.parse(json);
    if (parsed.error && parsed.error.code !== 2001) {
      throw new Error(`LiteAPI /hotels/rates: error ${parsed.error.code}`);
    }
    const names = new Map((parsed.hotels ?? []).map((h) => [h.id, h.name]));
    return parsed.data
      .flatMap((h) => {
        const rt = h.roomTypes[0];
        const price = Array.isArray(rt?.offerRetailRate)
          ? rt.offerRetailRate[0]
          : rt?.offerRetailRate;
        if (!rt || !price) return [];
        return [
          {
            offerId: rt.offerId,
            hotelId: h.hotelId,
            hotelName: names.get(h.hotelId) ?? h.hotelId,
            roomName: rt.rates?.[0]?.name ?? rt.name ?? "Room",
            board: rt.rates?.[0]?.boardName,
            total: price.amount,
            currency: price.currency,
          },
        ];
      })
      .sort((a, b) => a.total - b.total);
  }

  /** Checks live availability and locks the final price; the prebook id is what gets booked. */
  async prebook(offerId: string): Promise<HotelPrebook> {
    const { data } = PrebookResponse.parse(
      await this.post(`${BOOK}/rates/prebook`, { offerId, usePaymentSdk: false }),
    );
    const tag = data.roomTypes?.[0]?.rates[0]?.cancellationPolicies?.refundableTag;
    return {
      prebookId: data.prebookId,
      total: data.price,
      currency: data.currency,
      refundable: tag === undefined ? undefined : tag === "RFN",
    };
  }

  /** Confirms the booking with the sandbox's simulated card. */
  async book(
    prebookId: string,
    guest: HotelGuest,
    clientReference?: string,
  ): Promise<HotelBooking> {
    const { data } = BookResponse.parse(
      await this.post(`${BOOK}/rates/book`, {
        prebookId,
        clientReference,
        holder: guest,
        guests: [
          {
            occupancyNumber: 1,
            firstName: guest.firstName,
            lastName: guest.lastName,
            email: guest.email,
          },
        ],
        payment: { method: "ACC_CREDIT_CARD" },
      }),
    );
    return {
      bookingId: data.bookingId,
      status: data.status,
      confirmationCode: data.hotelConfirmationCode ?? undefined,
      hotelName: data.hotel?.name,
      total: data.price,
      currency: data.currency,
    };
  }
}
