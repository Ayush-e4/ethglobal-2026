import { describe, expect, it } from "vitest";
import { clientIp, rateLimit } from "./rate-limit";

describe("a limit per network address", () => {
  it("lets `max` through in a window, then refuses, then lets in again later", () => {
    let t = 0;
    const allow = rateLimit(3, 1000, () => t);
    expect([allow("1.2.3.4"), allow("1.2.3.4"), allow("1.2.3.4"), allow("1.2.3.4")]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(allow("5.6.7.8")).toBe(true); // someone else
    t = 1001;
    expect(allow("1.2.3.4")).toBe(true);
  });

  it("reads the visitor's address from the proxies' header", () => {
    const h = (v: Record<string, string>) => (n: string) => v[n];
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 10.0.0.2" }))).toBe("1.2.3.4");
    expect(clientIp(h({}))).toBeNull();
  });
});
