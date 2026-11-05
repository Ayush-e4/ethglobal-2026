import type { User } from "../db/schema";

export type Role = "user" | "admin";

/**
 * Roles come from the server's settings, never the client: admins are the account ids in
 * ADMIN_USERS. An admin can see usage and hide a merchant in the app; no role can touch money
 * (the contracts have no admin at all).
 */
export function rolesFor(user: User, adminUsers: ReadonlySet<string>): Role[] {
  return adminUsers.has(user.id) ? ["user", "admin"] : ["user"];
}
