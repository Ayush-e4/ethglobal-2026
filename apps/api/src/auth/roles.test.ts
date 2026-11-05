import { describe, expect, it } from "vitest";
import type { User } from "../db/schema";
import { rolesFor } from "./roles";

const user = { id: "u1", isDemo: false, displayName: null, createdAt: new Date() } as User;

describe("rolesFor", () => {
  it("admin only when the server lists the account", () => {
    expect(rolesFor(user, new Set())).toEqual(["user"]);
    expect(rolesFor(user, new Set(["u1"]))).toEqual(["user", "admin"]);
  });
});
