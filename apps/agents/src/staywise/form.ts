import type { Form } from "@app/shared";

/** What StayWise needs to quote a stay. Published in its Arkiv listing; checked on /quote. */
export const HOTEL_FORM: Form = {
  type: "object",
  properties: {
    iata: {
      type: "string",
      format: "iata",
      description: "The nearest airport's code: GOI for Goa, BOM for Mumbai, DEL for Delhi",
    },
    checkin: { type: "string", format: "date", description: "Check-in day" },
    checkout: { type: "string", format: "date", description: "Check-out day, after check-in" },
    adults: { type: "integer", minimum: 1, maximum: 4, description: "How many adults" },
    area: {
      type: "string",
      maxLength: 80,
      description: "Optional: a neighbourhood or landmark, with the city, e.g. Baga Beach, Goa",
    },
    maxTotal: {
      type: "integer",
      minimum: 500,
      description: "Optional: the most the whole stay may cost, in INR",
    },
    minStars: { type: "integer", minimum: 1, maximum: 5, description: "Optional: fewest stars" },
  },
  required: ["iata", "checkin", "checkout", "adults"],
};
