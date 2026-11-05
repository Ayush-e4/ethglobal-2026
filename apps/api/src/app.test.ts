import { describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("api", () => {
  const app = createApp({ appOrigin: "http://localhost:3000" });

  it("answers /health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("allows the app's origin only", async () => {
    const ok = await app.request("/health", { headers: { Origin: "http://localhost:3000" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    const other = await app.request("/health", { headers: { Origin: "https://evil.test" } });
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });
});
