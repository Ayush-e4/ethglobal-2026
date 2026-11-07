import { describe, expect, it } from "vitest";
import { ApiError, friendly, OUR_SIDE, SIGNED_OUT, saying, sentence, UNREACHABLE } from "./errors";

describe("what a failed request says", () => {
  it("keeps the API's own sentence", () => {
    expect(saying(409, { error: "cannot", message: "That limit isn't active any more." })).toBe(
      "That limit isn't active any more.",
    );
    expect(saying(400, { error: "a rating is 1 to 5 stars" })).toBe("A rating is 1 to 5 stars.");
  });

  it("never shows a bare code", () => {
    expect(saying(401, { error: "signed_out" })).toBe(SIGNED_OUT);
    expect(saying(404, { error: "not_found" })).toMatch(/^That isn't here any more/);
    expect(saying(404, { error: "not found" })).toMatch(/^That isn't here any more/);
    expect(saying(500, { error: "internal" })).toBe(OUR_SIDE);
    expect(saying(409, { error: "some_new_code" })).toMatch(/can't be done right now/);
    expect(saying(503, { message: "HTTP 503" })).toBe(OUR_SIDE);
  });

  it("speaks for an empty answer (a proxy page, a restart) by its status", () => {
    expect(saying(502, {})).toBe(OUR_SIDE);
    expect(saying(429, {})).toMatch(/Wait a few seconds/);
    expect(saying(400, {})).toBe("That didn't work. Try again.");
  });

  it("leaves setup details out", () => {
    expect(sentence("email isn't set up on this server (no RESEND_API_KEY)")).toBe(
      "Email isn't set up here.",
    );
  });
});

describe("anything caught", () => {
  it("uses our words, a dropped connection's, or the screen's own", () => {
    expect(friendly(new ApiError(409, "Already paid."), "x")).toBe("Already paid.");
    expect(friendly(new TypeError("Failed to fetch"), "x")).toBe(UNREACHABLE);
    expect(friendly(new Error("undefined is not a function"), "Couldn't load it.")).toBe(
      "Couldn't load it.",
    );
  });
});
