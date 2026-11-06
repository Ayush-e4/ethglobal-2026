import type { Form } from "@app/shared";

/** What a hotel agent needs to quote a stay (agents with a skill share its form). Published in its Arkiv listing; checked on /quote. */
export const HOTEL_FORM: Form = {
  type: "object",
  properties: {
    iata: {
      type: "string",
      format: "iata",
      description: "The nearest airport's IATA code, for the city: GOI for Goa, BOM for Mumbai",
      examples: ["GOI", "BOM", "DEL"],
    },
    checkin: {
      type: "string",
      format: "date",
      description: "Check-in day",
      examples: ["2026-12-20"],
    },
    checkout: { type: "string", format: "date", description: "Check-out day, after check-in" },
    adults: { type: "integer", minimum: 1, maximum: 4, description: "How many adults" },
    area: {
      type: "string",
      maxLength: 80,
      description: "Optional: a neighbourhood or landmark, with the city",
      examples: ["Baga Beach, Goa", "Bandra, Mumbai"],
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
