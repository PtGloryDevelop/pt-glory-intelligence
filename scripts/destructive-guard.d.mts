/**
 * Types for the destructive-database guard.
 *
 * The implementation is plain JavaScript because bare `node` scripts and
 * type-stripped tests both have to import the same copy; this file is what lets
 * the TypeScript side see it.
 */

export declare const PILOT_PROJECT_REF: string;

export declare class DestructiveRefusal extends Error {
  constructor(message: string);
}

export declare function describeTarget(connectionString: string | undefined | null): {
  host: string | null;
  user: string | null;
  label: string;
};

export declare function isPilotProject(connectionString: string | undefined | null): boolean;
export declare function isCloudDatabase(connectionString: string | undefined | null): boolean;

/**
 * `Record<string, string | undefined>` rather than `NodeJS.ProcessEnv`: Next
 * augments ProcessEnv with required keys, which would force every caller to
 * fabricate a NODE_ENV just to test a refusal.
 */
export declare function assertDestructiveAllowed(
  connectionString: string | undefined,
  action: string,
  env?: Record<string, string | undefined>,
): void;

/** The same rule for a Supabase project URL, which never touches DATABASE_URL. */
export declare function assertSupabaseTargetAllowed(
  projectUrl: string | undefined,
  action: string,
  env?: Record<string, string | undefined>,
): void;
