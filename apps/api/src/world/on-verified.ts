import type { WorldBonus } from "./bonus";
import type { OnVerified } from "./checks";
import type { WorldRatings } from "./ratings";

/**
 * What a passed check does, by purpose: a "bonus" check sends the bonus, a "rate" check posts the
 * rating it was started for. A "spend" check does nothing by itself: the hire finds it
 * (checkpoint.ts).
 */
export const onWorldVerified =
  (o: { bonus: WorldBonus; ratings: WorldRatings | null }): OnVerified =>
  async (c, v) => {
    if (c.purpose === "bonus") return o.bonus.give(c.userId, v);
    if (c.purpose === "rate") return o.ratings?.fromCheck(c, v);
    return undefined;
  };
