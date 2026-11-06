// The demo account, with real test money: travellers, chats, a hotel undone, a hotel delivered
// then reported (refunded), a flight delivered then cancelled, and a paid lookup.
import { type Card, check, part, Session, until } from "./http";
import { hotelsAndFlights } from "./trips";

const day = (plus: number) => new Date(Date.now() + plus * 86_400_000).toISOString().slice(0, 10);

export async function demoRoutes() {
  part("Demo account");
  const s = new Session();
  await s.expect("POST /auth/demo", 200, "POST", "/auth/demo", {});
  const me = await s.expect("GET /me", 200, "GET", "/me");
  check("signed in as a demo account", me.json?.isDemo === true || me.json?.user?.isDemo === true);
  for (const p of ["/wallet", "/wallet/limits", "/deals", "/world", "/alerts", "/trips", "/chats"])
    await s.expect(`GET ${p}`, 200, "GET", p);

  // Travellers (test people only).
  const person = {
    firstName: "Test",
    lastName: "Traveller",
    email: "test.traveller@example.com",
    phone: "+91 98000 00000",
    bornOn: "1990-01-01",
    gender: "m",
    isSelf: true,
  };
  const t = await s.expect("POST /travellers", 201, "POST", "/travellers", person);
  const traveller = t.json?.traveller?.id;
  await s.expect("PATCH /travellers/:id", 200, "PATCH", `/travellers/${traveller}`, {
    ...person,
    phone: "+91 98000 00001",
  });
  const second = await s.req("POST", "/travellers", {
    firstName: "Second",
    lastName: "Tester",
    email: "second.tester@example.com",
    phone: "+91 98000 00002",
  });
  await s.expect(
    "DELETE /travellers/:id",
    200,
    "DELETE",
    `/travellers/${second.json?.traveller?.id}`,
  );
  await s.expect("GET /travellers", 200, "GET", "/travellers");

  const newChat = async (title: string) => {
    const c = await s.expect(`POST /chats (${title})`, 201, "POST", "/chats", { title });
    await s.expect("POST /chats/:id/traveller", 200, "POST", `/chats/${c.json?.id}/traveller`, {
      travellerId: traveller,
    });
    return c.json?.id as string;
  };
  const hotelChat = await newChat("Smoke: Goa stay");
  await s.expect("GET /chats/:id", 200, "GET", `/chats/${hotelChat}`);
  await s.expect("GET /chats/:id/traveller", 200, "GET", `/chats/${hotelChat}/traveller`);

  await hotelsAndFlights(s, { hotelChat, flightChat: await newChat("Smoke: flight"), day });

  // A lookup, paid straight to the agent.
  const ask = await s.say(
    await newChat("Smoke: IFSC"),
    "Is HDFC0000240 a real IFSC? Which branch is it?",
  );
  const answer = ask.cards.find((c: Card) => c.type === "answer");
  check(
    "chat: Bank Check answers, paid",
    !!answer?.payTx,
    answer ? String(answer.title) : ask.words.slice(0, 120),
  );
  if (answer?.payTx) await onHedera(String(answer.payTx));

  await s.expect("POST /auth/logout", 200, "POST", "/auth/logout", {});
  await s.expect("signed out again: GET /me", 401, "GET", "/me");
}

/** A payment's transaction on Hedera's mirror node: SUCCESS. */
export async function onHedera(tx: string) {
  const id = tx.replace("@", "-").replace(/\.(\d+)$/, "-$1");
  const mirror = process.env.MIRROR_URL ?? "https://testnet.mirrornode.hedera.com";
  const r = await until(
    () =>
      fetch(`${mirror}/api/v1/transactions/${id}`)
        .then((x) => x.json() as Promise<{ transactions?: { result: string }[] }>)
        .catch(() => ({ transactions: [] })),
    (j) => (j.transactions?.length ?? 0) > 0,
    30,
  );
  const results = r.transactions?.map((t) => t.result) ?? [];
  check(
    "the payment is on Hedera",
    results.length > 0 && results.every((x) => x === "SUCCESS"),
    tx,
  );
}
