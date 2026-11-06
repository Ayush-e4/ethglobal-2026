import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

const O = "https://heyshikigami.duckdns.org";

describe("after sign-in, only a path on this site", () => {
  it("keeps paths here, and sends anything that leaves the site to the chat", () => {
    expect(safeNext("/trips?x=1", O)).toBe("/trips?x=1");
    for (const bad of [
      "/\\evil.example",
      "//evil.example",
      "https://evil.example",
      "/\\/evil.example",
      null,
    ])
      expect(safeNext(bad, O)).toBe("/chat");
  });
});
