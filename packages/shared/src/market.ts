import { z } from "zod";

/**
 * The open market's protocol, shared by the concierge and every agent. An agent publishes, in
 * its Arkiv listing, the form it needs filled to quote a job (a small JSON Schema); the
 * concierge fills it from the conversation; the agent answers GET /quote with one or more
 * offers, each also signed on Arkiv.
 */

/**
 * Field formats we check ourselves. Agents can't send their own regular expressions: a form
 * comes from a third party, and running its pattern on our server could hang it.
 */
export const FORMATS = {
  date: /^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD
  iata: /^[A-Z]{3}$/, // an airport, e.g. GOI
  country: /^[A-Z]{2}$/, // ISO 3166-1, e.g. IN
  email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
} as const;
const FORMAT_NAMES: Record<keyof typeof FORMATS, string> = {
  date: "a date like 2026-12-14",
  iata: "an airport code like GOI",
  country: "a country code like IN",
  email: "an email address",
};

const FieldSchema = z.object({
  type: z.enum(["string", "integer", "number", "boolean"]),
  description: z.string().max(300).optional(),
  format: z.enum(Object.keys(FORMATS) as [keyof typeof FORMATS]).optional(),
  enum: z
    .array(z.union([z.string().max(100), z.number()]))
    .max(50)
    .optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  maxLength: z.number().int().min(1).max(500).optional(),
});

/** What an agent needs to quote a job: up to 20 named fields. */
export const FormSchema = z.object({
  type: z.literal("object"),
  properties: z
    .record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/), FieldSchema)
    .refine((p) => Object.keys(p).length <= 20, "at most 20 fields"),
  required: z.array(z.string()).max(20).default([]),
});
export type Form = z.infer<typeof FormSchema>;
export type FormValue = string | number | boolean;

/**
 * Checks a filled form, keeping only its own fields. `coerce`: values arrived as text (a query
 * string), so "2" may be the integer 2. Returns the values, or what's wrong with them.
 */
export function checkForm(
  form: Form,
  input: unknown,
  opts: { coerce?: boolean } = {},
): { ok: true; values: Record<string, FormValue> } | { ok: false; problems: string[] } {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { ok: false, problems: ["the input must be an object of fields"] };
  const given = input as Record<string, unknown>;
  const values: Record<string, FormValue> = {};
  const problems: string[] = [];
  for (const [name, f] of Object.entries(form.properties)) {
    let v = given[name];
    if (v === undefined || v === null || v === "") {
      if (form.required.includes(name)) problems.push(`${name} is required`);
      continue;
    }
    if (opts.coerce && typeof v === "string") {
      if (f.type === "integer" || f.type === "number") v = Number(v);
      else if (f.type === "boolean") v = v === "true" ? true : v === "false" ? false : v;
    }
    const before = problems.length;
    const bad = (why: string) => problems.push(`${name} ${why}`);
    if (f.type === "string") {
      if (typeof v !== "string") bad("must be text");
      else if (v.length > (f.maxLength ?? 200)) bad("is too long");
      else if (f.format && !FORMATS[f.format].test(v)) bad(`must be ${FORMAT_NAMES[f.format]}`);
    } else if (f.type === "boolean") {
      if (typeof v !== "boolean") bad("must be true or false");
    } else if (typeof v !== "number" || !Number.isFinite(v)) bad("must be a number");
    else if (f.type === "integer" && !Number.isInteger(v)) bad("must be a whole number");
    else if (f.minimum !== undefined && v < f.minimum) bad(`must be at least ${f.minimum}`);
    else if (f.maximum !== undefined && v > f.maximum) bad(`must be at most ${f.maximum}`);
    if (f.enum && !f.enum.includes(v as string | number))
      bad(`must be one of ${f.enum.join(", ")}`);
    if (problems.length === before) values[name] = v as FormValue;
  }
  return problems.length ? { ok: false, problems } : { ok: true, values };
}

const https = z.url().refine((u) => u.startsWith("https://"), "https only");

/** One firm offer from an agent: what it is, its price, and its quote key on Arkiv. */
export const OfferSchema = z.object({
  key: z.string().regex(/^0x[0-9a-fA-F]{64}$/), // the agent's quote on Arkiv
  title: z.string().min(1).max(120), // e.g. the hotel
  tag: z.string().max(40).optional(), // why it's here: "Cheapest", "Best rated"
  subtitle: z.string().max(160).optional(), // e.g. the room
  summary: z.string().min(1).max(300), // one line, also the hire's title
  feeUnits: z.string().regex(/^\d+$/), // the agent's fee in USDC units, held until delivered
  price: z.object({ amount: z.number().nonnegative(), currency: z.string().max(5) }).optional(),
  refundable: z.boolean().optional(),
  rating: z
    .object({
      stars: z.number().min(0).max(5).optional(),
      score: z.number().min(0).max(10).optional(), // guests' score
      reviews: z.number().int().nonnegative().optional(),
    })
    .optional(),
  location: z.string().max(160).optional(),
  images: z.array(https).max(4).optional(),
  details: z.array(z.string().max(120)).max(6).optional(),
});
export type Offer = z.infer<typeof OfferSchema>;

/** An agent's answer to GET /quote. */
export const QuoteReplySchema = z.object({ offers: z.array(OfferSchema).min(1).max(5) });

/** "2026-12-14", "2026-12-16" → "14–16 Dec"; across months "30 Dec – 2 Jan". */
export function stay(checkin: string, checkout: string) {
  const day = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
  const [a, b] = [day(checkin), day(checkout)];
  const [d1, m1] = a.split(" ");
  const [d2, m2] = b.split(" ");
  return m1 === m2 ? `${d1}–${d2} ${m2}` : `${a} – ${b}`;
}
