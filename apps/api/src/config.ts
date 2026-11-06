import { z } from "zod";

/** The API's settings, from env. Errors name the setting, never its value. */
const Env = z.object({
  PORT: z.coerce.number().default(8787),
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().startsWith("postgres"),
  ADMIN_USERS: z.string().default(""), // account ids, comma-separated
});

export function loadConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`API settings:\n  ${fields.join("\n  ")}`);
  }
  const e = parsed.data;
  const origin = new URL(e.APP_ORIGIN);
  return {
    port: e.PORT,
    appOrigin: origin.origin,
    databaseUrl: e.DATABASE_URL,
    auth: {
      site: { rpID: origin.hostname, origin: origin.origin, name: "Shikigami" },
      adminUsers: new Set(
        e.ADMIN_USERS.split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
      secureCookies: origin.protocol === "https:",
    },
  };
}
