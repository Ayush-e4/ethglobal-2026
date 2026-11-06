import { z } from "zod";

/** What LiteAPI answers, as far as we read it (unknown fields are ignored). */
const Money = z.object({ amount: z.number(), currency: z.string() });
export const RatesResponse = z.object({
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
export const PlacesResponse = z.object({
  data: z.array(z.object({ placeId: z.string(), displayName: z.string().optional() })).default([]),
});
export const DetailsResponse = z.object({
  data: z.object({
    hotelImages: z.array(z.object({ url: z.string() })).default([]),
    hotelFacilities: z.array(z.string()).default([]),
  }),
});
export const PrebookResponse = z.object({
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
export const BookResponse = z.object({
  data: z.object({
    bookingId: z.string(),
    status: z.string(),
    hotelConfirmationCode: z.string().nullish(),
    hotel: z.object({ name: z.string() }).partial().optional(),
    price: z.number().optional(),
    currency: z.string().optional(),
  }),
});
export const CancelResponse = z.object({
  data: z.object({
    bookingId: z.string(),
    status: z.string(),
    cancellation_fee: z.number().optional(),
    refund_amount: z.number().optional(),
    currency: z.string(),
  }),
});
