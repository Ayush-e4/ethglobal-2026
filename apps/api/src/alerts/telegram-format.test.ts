import type { Card } from "@app/shared";
import { describe, expect, it } from "vitest";
import { cardMessages, chunks, html } from "./telegram-format";

const offer = (key: string, title: string, img: string) => ({
  key,
  title,
  note: "",
  feeUnits: "20000",
  itemTotal: 11927,
  itemCurrency: "INR",
  reply: `Book ${title} (quote ${key.slice(0, 10)})`,
  images: [img],
});
const KEY_A = `0x${"a1".repeat(32)}`;
const KEY_B = `0x${"b2".repeat(32)}`;
const QUOTES: Card = {
  type: "quotes",
  skill: "hotels",
  reason: "Each picked for a reason",
  quotes: [],
};

describe("Telegram formatting", () => {
  it("turns the concierge's Markdown into Telegram HTML, escaping the rest", () => {
    expect(html("**Park Inn** <3 & [map](https://m.example/a?b=1)\n- pool\n## Next")).toBe(
      '<b>Park Inn</b> &lt;3 &amp; <a href="https://m.example/a?b=1">map</a>\n• pool\n<b>Next</b>',
    );
  });

  it("the same hotel from two agents is one message, with a button for each way of working", () => {
    const twice: Card = {
      ...QUOTES,
      quotes: [
        { ...offer(KEY_A, "Park Inn · StayWise", "https://p/1.jpg"), model: "Book it, done" },
        {
          ...offer(KEY_B, "Park Inn · PriceGuard", "https://p/1.jpg"),
          model: "Book and keep watching",
          feeUnits: "50000",
        },
      ],
    };
    const [one, ...rest] = cardMessages(twice, null);
    expect(rest).toEqual([]);
    const markup = one?.body.reply_markup as { inline_keyboard: { text: string }[][] } | undefined;
    expect(markup?.inline_keyboard.map((r) => r[0]?.text)).toEqual([
      "StayWise: Book it, done · 0.02 USDC",
      "PriceGuard: Book and keep watching · 0.05 USDC",
    ]);
  });

  it("splits long replies on paragraph breaks", () => {
    const parts = chunks(["a".repeat(3000), "b".repeat(3000)].join("\n\n"));
    expect(parts.map((p) => p.length)).toEqual([3000, 3000]);
  });
});
