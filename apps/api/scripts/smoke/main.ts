// The smoke test: every route, as people and apps use them, on a running AgentNet.
// Spends test money only (Hedera testnet, LiteAPI sandbox, Duffel test mode); test travellers.
// Run: pnpm smoke  (SMOKE_API / SMOKE_ORIGIN point it at another server; --only=public,demo,passkey)
import { connectorRoutes } from "./connector";
import { demoRoutes } from "./demo";
import { API, report } from "./http";
import { passkeyRoutes } from "./passkey";
import { publicRoutes } from "./public";

const only = process.argv
  .find((a) => a.startsWith("--only="))
  ?.slice(7)
  .split(",");
const run = (part: string) => !only || only.includes(part);
const started = Date.now();
console.log(`Smoke test against ${API}`);
const step = async (name: string, f: () => Promise<unknown>) =>
  f().catch((err) => {
    console.log(`✗ ${name} stopped: ${err instanceof Error ? err.message : err}`);
    report().push({ name: `${name}: stopped`, ok: false, note: String(err).slice(0, 200) });
  });
if (run("public")) await step("public", publicRoutes);
if (run("demo")) await step("demo", demoRoutes);
if (run("passkey"))
  await step("passkey", async () => {
    const s = await passkeyRoutes();
    await connectorRoutes(s);
  });

const all = report();
const failed = all.filter((r) => !r.ok);
console.log(
  `\n${all.length - failed.length}/${all.length} passed in ${Math.round((Date.now() - started) / 1000)} s`,
);
for (const f of failed) console.log(`✗ ${f.name}${f.note ? `  (${f.note})` : ""}`);
process.exit(failed.length ? 1 : 0);
