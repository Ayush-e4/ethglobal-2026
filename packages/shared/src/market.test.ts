import { describe, expect, it } from "vitest";
import { checkForm, type Form, FormSchema, OfferSchema, stay } from "./market";

const hotels: Form = FormSchema.parse({
  type: "object",
  properties: {
    iata: { type: "string", format: "iata" },
    checkin: { type: "string", format: "date" },
    adults: { type: "integer", minimum: 1, maximum: 4 },
    refundable: { type: "boolean" },
    city: { type: "string", enum: ["Goa", "Mumbai"] },
  },
  required: ["iata", "checkin", "adults"],
});

describe("checkForm", () => {
  it("keeps only the form's fields, and only valid ones", () => {
    const r = checkForm(hotels, { iata: "GOI", checkin: "2026-12-14", adults: 2, extra: "x" });
    expect(r).toEqual({ ok: true, values: { iata: "GOI", checkin: "2026-12-14", adults: 2 } });
  });

  it("says what's wrong, field by field", () => {
    const r = checkForm(hotels, { iata: "Goa", adults: 2.5, refundable: "yes", city: "Delhi" });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.problems).toEqual([
        "iata must be an airport code like GOI",
        "checkin is required",
        "adults must be a whole number",
        "refundable must be true or false",
        "city must be one of Goa, Mumbai",
      ]);
  });

  it("reads a query string's text when asked to", () => {
    const query = { iata: "GOI", checkin: "2026-12-14", adults: "2", refundable: "true" };
    expect(checkForm(hotels, query, { coerce: true })).toEqual({
      ok: true,
      values: { iata: "GOI", checkin: "2026-12-14", adults: 2, refundable: true },
    });
    expect(checkForm(hotels, query).ok).toBe(false); // without it, "2" isn't a number
  });

  it("refuses forms with their own patterns or too many fields", () => {
    const pattern = { type: "object", properties: { a: { type: "string", pattern: "(a+)+$" } } };
    expect(FormSchema.safeParse(pattern).data?.properties.a).not.toHaveProperty("pattern");
    const many = Object.fromEntries(
      Array.from({ length: 21 }, (_, i) => [`f${i}`, { type: "string" }]),
    );
    expect(FormSchema.safeParse({ type: "object", properties: many }).success).toBe(false);
  });
});

describe("offers", () => {
  it("only take https images", () => {
    const base = {
      key: `0x${"ab".repeat(32)}`,
      title: "Sea Breeze",
      summary: "2 nights",
      feeUnits: "20000",
    };
    expect(OfferSchema.safeParse({ ...base, images: ["https://img.example/a.jpg"] }).success).toBe(
      true,
    );
    expect(OfferSchema.safeParse({ ...base, images: ["http://img.example/a.jpg"] }).success).toBe(
      false,
    );
  });

  it("stays read like a person wrote them", () => {
    expect(stay("2026-12-14", "2026-12-16")).toBe("14–16 Dec");
    expect(stay("2026-12-30", "2027-01-02")).toBe("30 Dec – 2 Jan");
  });
});
