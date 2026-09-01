/**
 * Pure role logic. No Next.js or Supabase imports, so it stays unit-testable
 * without a request context.
 */

export const ROLES = ["viewer", "analyst", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** Higher rank satisfies every requirement at or below it. */
const RANK: Record<Role, number> = { viewer: 0, analyst: 1, admin: 2 };

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function satisfies(actual: Role, required: Role): boolean {
  return RANK[actual] >= RANK[required];
}

export class AuthorizationError extends Error {
  status: 401 | 403;

  constructor(status: 401 | 403, message: string) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
  }
}

export type Actor = { userId: string; role: Role };
