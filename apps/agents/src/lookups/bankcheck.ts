import { resolve } from "node:path";
import type { Answer, Form, Service } from "@app/shared";
import { z } from "zod";

/** Bank Check: an IFSC code → the bank, branch and which payments it takes. A lookup agent. */
export const BANKCHECK = {
  env: "BANKCHECK",
  name: "Bank Check",
  port: 8804,
  feeUsd: "$0.001",
  skill: "bank-check",
  title: "Check an IFSC code",
  description:
    "Checks an Indian bank branch's IFSC code: the bank, branch, address, and whether it takes UPI, IMPS, NEFT and RTGS. Paid per lookup.",
  service: {
    model: "Pay per lookup",
    promise: "An answer at once from public data, or nothing charged if the code isn't found.",
  } satisfies Service,
} as const;

export const BANKCHECK_FORM: Form = {
  type: "object",
  properties: {
    ifsc: {
      type: "string",
      format: "ifsc",
      description: "The branch's 11-character IFSC code, as printed on a cheque or passbook",
      examples: ["HDFC0000240", "SBIN0000300"],
    },
  },
  required: ["ifsc"],
};

export function loadBankCheckConfig(env: Record<string, string | undefined> = process.env) {
  const setup = "run pnpm --filter @app/agents agents-setup";
  const e = z
    .object({
      BANKCHECK_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, setup),
      BANKCHECK_ACCOUNT_ID: z.string().regex(/^0\.0\.\d+$/, setup),
      BANKCHECK_PORT: z.coerce.number().default(BANKCHECK.port),
      BANKCHECK_URL: z.url().optional(),
      FACILITATOR_URL: z.url().default("http://localhost:8790"),
    })
    .parse(env);
  return {
    id: "bankcheck" as const,
    ...BANKCHECK,
    key: e.BANKCHECK_PRIVATE_KEY as `0x${string}`,
    accountId: e.BANKCHECK_ACCOUNT_ID,
    port: e.BANKCHECK_PORT,
    publicUrl: e.BANKCHECK_URL ?? `http://localhost:${e.BANKCHECK_PORT}`,
    facilitatorUrl: e.FACILITATOR_URL,
    dataDir: resolve(import.meta.dirname, "../../.data"),
  };
}

const Razorpay = z.object({
  BANK: z.string(),
  BRANCH: z.string(),
  ADDRESS: z.string().nullish(),
  CITY: z.string().nullish(),
  STATE: z.string().nullish(),
  MICR: z.string().nullish(),
  UPI: z.boolean().nullish(),
  IMPS: z.boolean().nullish(),
  NEFT: z.boolean().nullish(),
  RTGS: z.boolean().nullish(),
});
const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** The answer, from Razorpay's public IFSC data (free, no key); null if the code isn't found. */
export async function ifscAnswer(
  ifsc: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Answer | null> {
  const res = await fetchImpl(`https://ifsc.razorpay.com/${encodeURIComponent(ifsc)}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null;
  const b = Razorpay.safeParse(await res.json().catch(() => null));
  if (!res.ok || !b.success) throw new Error(`IFSC lookup failed (${res.status})`);
  const r = b.data;
  const takes = (["UPI", "IMPS", "NEFT", "RTGS"] as const).filter((k) => r[k]);
  return {
    title: `${r.BANK} · ${title(r.BRANCH)}${r.CITY ? `, ${title(r.CITY)}` : ""}`,
    lines: [
      { label: "IFSC", value: ifsc },
      { label: "Bank", value: r.BANK },
      { label: "Branch", value: title(r.BRANCH) },
      ...(r.ADDRESS ? [{ label: "Address", value: r.ADDRESS.slice(0, 300) }] : []),
      ...(r.STATE ? [{ label: "State", value: title(r.STATE) }] : []),
      { label: "Takes", value: takes.length ? takes.join(" · ") : "none listed" },
      ...(r.MICR ? [{ label: "MICR", value: r.MICR }] : []),
    ],
    source: "Razorpay IFSC (public data)",
  };
}
