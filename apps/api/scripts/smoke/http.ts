// The smoke test's HTTP side: one signed-in session (its cookie), chat turns, and the report.
export const API = (
  process.env.SMOKE_API ??
  process.env.API_URL ??
  "http://localhost:8787"
).replace(/\/$/, "");
export const ORIGIN = process.env.SMOKE_ORIGIN ?? process.env.APP_ORIGIN ?? "http://localhost:3000";

export type Card = { type: string; [k: string]: unknown };
// biome-ignore lint/suspicious/noExplicitAny: a smoke test reads loose JSON replies
export type Reply = { status: number; json: any; headers: Headers };

const results: { name: string; ok: boolean; note: string }[] = [];
let section = "";
export const part = (name: string) => {
  section = name;
  console.log(`\n── ${name}`);
};
/** One line of the report. */
export function check(name: string, ok: boolean, note = "") {
  results.push({ name: `${section}: ${name}`, ok, note });
  console.log(`${ok ? "✓" : "✗"} ${name}${note ? `  (${note})` : ""}`);
  return ok;
}
export const report = () => results;

export const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
/** Asks again every few seconds until `done` says yes, or the time is up. */
export async function until<T>(get: () => Promise<T>, done: (v: T) => boolean, secs: number) {
  const end = Date.now() + secs * 1000;
  let v = await get();
  while (!done(v) && Date.now() < end) {
    await sleep(4);
    v = await get();
  }
  return v;
}

/** An agent's server, from its page's host (plain http only on this machine). */
export const agentUrl = (host: string) =>
  `${/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https"}://${host}`;

export class Session {
  cookie = "";

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const url = path.startsWith("http") ? path : `${API}${path}`;
    const res = await fetch(url, {
      method,
      redirect: "manual",
      headers: {
        origin: ORIGIN,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(600_000), // a chat turn that pays can wait on a slow Hedera
    });
    const set = res.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0] ?? "";
    const text = await res.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, headers: res.headers } as Reply;
  }

  /** A request that should answer `want`; the report names it `label`. */
  async expect(label: string, want: number, method: string, path: string, body?: unknown) {
    const r = await this.req(method, path, body).catch(
      (err): Reply => ({ status: 0, json: String(err), headers: new Headers() }),
    );
    const why = r.status === want ? "" : `got ${r.status}: ${JSON.stringify(r.json).slice(0, 160)}`;
    check(label, r.status === want, why);
    return r;
  }

  /** One chat turn: the streamed words, cards and status lines. */
  async say(chatId: string, text: string) {
    const r = await this.req("POST", `/chats/${chatId}/messages`, { text });
    const events = String(r.json)
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .flatMap((l) => {
        try {
          return [JSON.parse(l.slice(5)) as { type: string; delta?: string; card?: Card }];
        } catch {
          return [];
        }
      });
    return {
      status: r.status,
      words: events.map((e) => (e.type === "text" ? (e.delta ?? "") : "")).join(""),
      cards: events.flatMap((e) => (e.type === "card" && e.card ? [e.card] : [])),
    };
  }
}
