import type { Form } from "@app/shared";

/** What the flight agent needs to quote a flight. Published in its Arkiv listing; checked on /quote. */
export const FLIGHT_FORM: Form = {
  type: "object",
  properties: {
    from: {
      type: "string",
      format: "iata",
      description: "The departure airport's IATA code",
      examples: ["BOM", "DEL", "BLR"],
    },
    to: {
      type: "string",
      format: "iata",
      description: "The arrival airport's IATA code: GOI for Goa",
      examples: ["GOI", "BOM"],
    },
    date: {
      type: "string",
      format: "date",
      description: "The day to fly",
      examples: ["2026-12-20"],
    },
    returnDate: {
      type: "string",
      format: "date",
      description: "Optional: the day to fly back, for a return trip",
    },
  },
  required: ["from", "to", "date"],
};
