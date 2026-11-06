// A passkey account, with a software passkey kept in .data (made once: signing up makes a Face
// ID wallet on Hedera, with a small test USDC gift). Sign-in, a second device, then the own
// wallet's path: a Face ID lookup limit, a lookup paid from the wallet, the limit revoked.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type SavedPasskey, softPasskey } from "../../src/test/passkey";
import { onHedera } from "./demo";
import { type Card, check, ORIGIN, part, Session, until } from "./http";

// One saved passkey per address: a passkey only works on the site it was made for.
const host = new URL(ORIGIN).hostname;
const SAVED = resolve(
  import.meta.dirname,
  host === "localhost"
    ? "../../.data/smoke-passkey.json"
    : `../../.data/smoke-passkey-${host}.json`,
);
type Device = ReturnType<typeof softPasskey>;

async function signIn(s: Session): Promise<Device> {
  const saved = existsSync(SAVED)
    ? (JSON.parse(readFileSync(SAVED, "utf8")) as SavedPasskey & { origin: string })
    : null;
  if (saved?.origin === ORIGIN) {
    const device = softPasskey(ORIGIN, saved);
    const o = await s.expect(
      "POST /auth/passkey/login-options",
      200,
      "POST",
      "/auth/passkey/login-options",
      {},
    );
    const r = await s.expect("POST /auth/passkey/login", 200, "POST", "/auth/passkey/login", {
      response: device.signIn(o.json?.challenge),
    });
    if (r.status === 200) return device;
  }
  const device = softPasskey(ORIGIN);
  const o = await s.expect(
    "POST /auth/passkey/register-options",
    200,
    "POST",
    "/auth/passkey/register-options",
    { name: "Smoke test" },
  );
  await s.expect("POST /auth/passkey/register", 200, "POST", "/auth/passkey/register", {
    response: device.register(o.json?.challenge),
    label: "Smoke test",
  });
  mkdirSync(dirname(SAVED), { recursive: true });
  writeFileSync(SAVED, JSON.stringify({ ...device.save(), origin: ORIGIN }), { mode: 0o600 });
  return device;
}

/** Face ID, the software way: prepare (what to sign), sign, run. */
async function faceId(
  s: Session,
  device: Device,
  label: string,
  prepare: string,
  run: string,
  body: object = {},
) {
  const p = await s.expect(
    `${label}: prepare (POST ${prepare.replace(/[0-9a-f-]{36}/g, ":id")})`,
    200,
    "POST",
    prepare,
    body,
  );
  if (p.status !== 200) return null;
  return s.expect(
    `${label}: approve (POST ${run.replace(/[0-9a-f-]{36}/g, ":id")})`,
    run.includes("/limits") && !run.includes("revoke") ? 201 : 200,
    "POST",
    run,
    {
      opId: p.json?.opId,
      response: device.signIn(p.json?.options?.challenge),
    },
  );
}

export async function passkeyRoutes() {
  part("Passkey account (own Face ID wallet)");
  const s = new Session();
  const device = await signIn(s);
  const me = await s.expect("GET /me", 200, "GET", "/me");
  check("signed in with a passkey", !(me.json?.isDemo ?? me.json?.user?.isDemo));
  const w = await until(
    async () => (await s.req("GET", "/wallet")).json?.wallet,
    (w) => w?.status === "ready",
    150,
  );
  check(
    "GET /wallet: the Face ID wallet is ready",
    w?.status === "ready",
    `${w?.status} ${w?.hederaId ?? ""}`,
  );
  for (const p of [
    "/account/devices",
    "/account/email",
    "/oauth/grants",
    "/wallet/limits",
    "/alerts",
    "/deals",
    "/world",
  ])
    await s.expect(`GET ${p}`, 200, "GET", p);

  // A second device joins the same account with a one-time code, then is removed.
  const code = await s.expect(
    "POST /account/devices/link",
    200,
    "POST",
    "/account/devices/link",
    {},
  );
  const phone = new Session();
  const other = softPasskey(ORIGIN);
  const opts = await phone.expect(
    "POST /auth/passkey/link/options",
    200,
    "POST",
    "/auth/passkey/link/options",
    { code: code.json?.code },
  );
  const joined = await phone.expect("POST /auth/passkey/link", 200, "POST", "/auth/passkey/link", {
    code: code.json?.code,
    response: other.register(opts.json?.options?.challenge),
  });
  check(
    "the second device is the same account",
    joined.json?.id === me.json?.id || joined.json?.id === me.json?.user?.id,
  );
  const devices = (await s.req("GET", "/account/devices")).json as {
    id: string;
    onWallet: boolean;
  }[];
  const added = devices.find((x) => !x.onWallet);
  check("both devices are listed", devices.length >= 2);
  if (added)
    await s.expect("DELETE /account/devices/:id", 200, "DELETE", `/account/devices/${added.id}`);

  // The own wallet pays: a lookup needs a small limit approved with Face ID first.
  const units = Number(w?.usdcUnits ?? 0);
  if (!check("the wallet has test USDC for a lookup", units >= 1000, `${units / 1e6} USDC`))
    return s;
  const chat = (
    await s.expect("POST /chats", 201, "POST", "/chats", { title: "Smoke: own wallet" })
  ).json?.id;
  const first = await s.say(chat, "Check the IFSC SBIN0000300 for me.");
  const limit = first.cards.find((c: Card) => c.type === "limit");
  check("chat: asks for a Face ID lookup limit first", !!limit, first.words.slice(0, 120));
  if (!limit) return s;
  const set = await faceId(
    s,
    device,
    "Face ID limit",
    `/chats/${chat}/limits/face-id`,
    `/chats/${chat}/limits`,
    { payee: limit.payee },
  );
  check("the limit is on Hedera", !!set?.json?.mandateId, set?.json?.tx);
  const again = await s.say(chat, String(limit.reply));
  const answer = again.cards.find((c: Card) => c.type === "answer");
  check(
    "chat: answered, paid from the own wallet",
    !!answer?.payTx,
    answer ? String(answer.title) : again.words.slice(0, 120),
  );
  if (answer?.payTx) await onHedera(String(answer.payTx));
  const mine = (
    (await s.req("GET", "/wallet/limits")).json as { id: string; chatId: string; status: string }[]
  ).find((l) => l.chatId === chat && l.status === "active");
  if (mine) {
    await faceId(
      s,
      device,
      "Face ID revoke",
      `/wallet/limits/${mine.id}/revoke/face-id`,
      `/wallet/limits/${mine.id}/revoke`,
    );
    const after = (
      (await s.req("GET", "/wallet/limits")).json as { id: string; status: string }[]
    ).find((l) => l.id === mine.id);
    check("the limit is revoked", after?.status !== "active", after?.status);
  }
  return s;
}
