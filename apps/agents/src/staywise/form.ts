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
  },
  required: ["iata", "checkin", "checkout", "adults"],
};
