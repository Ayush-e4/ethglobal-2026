import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type { Db } from "../db/client";
import type { User } from "../db/schema";
import { SESSION_COOKIE, userForToken } from "./session";

/** The signed-in user, or null. Routes answer 401 themselves. */
export const currentUser = (db: Db, c: Context): Promise<User | null> =>
  userForToken(db, getCookie(c, SESSION_COOKIE));
