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
  hotels: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        main_photo: z.string().nullish(),
        city_name: z.string().nullish(),
        address: z.string().nullish(),
        rating: z.number().nullish(), // guests' score out of 10
        stars: z.number().nullish(),
        review_count: z.number().nullish(),
      }),
    )
    .optional(),
});
const PlacesResponse = z.object({
  data: z.array(z.object({ placeId: z.string(), displayName: z.string().optional() })).default([]),
});
const DetailsResponse = z.object({
  data: z.object({
    hotelImages: z.array(z.object({ url: z.string() })).default([]),
    hotelFacilities: z.array(z.string()).default([]),
  }),
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
  photo?: string; // https
  area?: string; // e.g. Candolim
  address?: string;
  score?: number; // guests' score out of 10
  stars?: number;
  reviews?: number;
}

const httpsOnly = (u: string | null | undefined) => (u?.startsWith("https://") ? u : undefined);

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

  private async get(path: string): Promise<unknown> {
    const res = await this.fetchImpl(`${API}${path}`, { headers: { "X-API-Key": this.apiKey } });
    if (!res.ok) throw new Error(`LiteAPI ${path.split("?")[0]}: HTTP ${res.status}`);
    return res.json();
  }

  /** A neighbourhood or landmark ("Baga Beach, Goa") as a place to search around, if found. */
  async findPlace(text: string): Promise<string | null> {
    const json = await this.get(`/data/places?textQuery=${encodeURIComponent(text)}`);
    return PlacesResponse.parse(json).data[0]?.placeId ?? null;
  }

  /** A hotel's photos (https) and facilities, for showing it. */
  async hotelDetails(hotelId: string, photos = 4) {
    const { data } = DetailsResponse.parse(
      await this.get(`/data/hotel?hotelId=${encodeURIComponent(hotelId)}`),
    );
    const images = data.hotelImages.map((i) => httpsOnly(i.url)).filter((u) => u !== undefined);
    return { images: images.slice(0, photos), facilities: data.hotelFacilities };
  }

  /**
   * Hotels near an airport (IATA code) or a place (from findPlace), cheapest offer per hotel,
   * cheapest first, with what's needed to show each: photo, area, score, stars.
   */
  async searchHotels(q: {
    iataCode?: string;
    placeId?: string;
    checkin: string; // YYYY-MM-DD
    checkout: string;
    adults: number;
    refundableOnly?: boolean;
    limit?: number;
  }): Promise<HotelOffer[]> {
    if (!q.iataCode && !q.placeId) throw new Error("LiteAPI: search needs an airport or a place");
    const json = await this.post(`${API}/hotels/rates`, {
      ...(q.placeId ? { placeId: q.placeId } : { iataCode: q.iataCode }),
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
    const hotels = new Map((parsed.hotels ?? []).map((h) => [h.id, h]));
    return parsed.data
      .flatMap((h) => {
        const rt = h.roomTypes[0];
        const price = Array.isArray(rt?.offerRetailRate)
          ? rt.offerRetailRate[0]
          : rt?.offerRetailRate;
        if (!rt || !price) return [];
        const info = hotels.get(h.hotelId);
        return [
          {
            offerId: rt.offerId,
            hotelId: h.hotelId,
            hotelName: info?.name ?? h.hotelId,
            photo: httpsOnly(info?.main_photo),
            area: info?.city_name ?? undefined,
            address: info?.address ?? undefined,
            score: info?.rating ?? undefined,
            stars: info?.stars ?? undefined,
            reviews: info?.review_count ?? undefined,
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
