/**
 * Fail-closed protection for every path that can destroy or fabricate data.
 *
 * The rule this enforces: a connection string is not authorization. Until now a
 * `DATABASE_URL` in the environment was the only thing standing between
 * `truncate ... cascade` and whatever database happened to be configured — and
 * the same file is edited by hand when switching targets. That is a mistake
 * waiting for a tired evening.
 *
 * Three independent conditions must ALL hold before anything destructive runs:
 *
 *   1. PT_GLORY_ENV names a disposable environment (dev or test). Unset is a
 *      refusal, not a default: a forgotten variable must never read as consent.
 *   2. ALLOW_DESTRUCTIVE_DB_RESET=1 is set deliberately, per shell.
 *   3. The target is not a Supabase Cloud database.
 *
 * The third check is not overridable. It is the one that matters, because the
 * first two live in a file somebody can copy from another machine, and because
 * the Cloud project below is now the PILOT environment holding real research
 * data. No combination of environment variables can point a reset at it.
 *
 * Plain JavaScript on purpose: the .mjs scripts run under bare `node`, while
 * the tests run with type stripping. One implementation has to serve both, or
 * the two will drift and only one of them will be guarded.
 */

/**
 * The Supabase Cloud project that is being repurposed as PILOT / STAGING.
 * Its ref appears in both the direct host (`db.<ref>.supabase.co`) and the
 * pooler username (`postgres.<ref>`), so both are checked.
 */
export const PILOT_PROJECT_REF = "hufzfbqfwusfiaywtnvy";

/** Environments in which fixtures may be wiped and rebuilt. */
const DISPOSABLE = new Set(["dev", "test"]);

/**
 * Any Supabase-hosted database. Broader than the pilot ref by design: a second
 * Cloud project would be just as real, just as shared, and just as impossible
 * to restore from a fixture file. Local development uses a local database.
 */
const CLOUD_HOST = /(^|\.)(supabase\.co|supabase\.com|supabase\.in)$/i;

/** Hosts a disposable database may live on. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|host\.docker\.internal|db|supabase_db_.*)$/i;

export class DestructiveRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "DestructiveRefusal";
  }
}

/**
 * Host and user, without the password.
 *
 * A refusal has to say which database it refused, and a connection string
 * carries a credential — so it is never echoed, logged, or thrown. Only the
 * parts a person needs in order to recognise their mistake come back.
 */
export function describeTarget(connectionString) {
  if (!connectionString) return { host: null, user: null, label: "(no DATABASE_URL set)" };
  try {
    const url = new URL(connectionString);
    const host = url.hostname;
    const user = decodeURIComponent(url.username || "");
    const database = url.pathname.replace(/^\//, "") || "(default)";
    return { host, user, label: `${host}/${database}` };
  } catch {
    return { host: null, user: null, label: "(unparseable DATABASE_URL)" };
  }
}

/** True when the target is the Cloud project now serving as PILOT. */
export function isPilotProject(connectionString) {
  const { host, user } = describeTarget(connectionString);
  if (!host) return false;
  return host.includes(PILOT_PROJECT_REF) || (user ?? "").includes(PILOT_PROJECT_REF);
}

/** True when the target is any Supabase-hosted database. */
export function isCloudDatabase(connectionString) {
  const { host } = describeTarget(connectionString);
  return host !== null && CLOUD_HOST.test(host);
}

/**
 * Throws unless this process may destroy data in the given database.
 *
 * @param {string | undefined} connectionString  the database about to be written
 * @param {string} action  what is being attempted, for the refusal message
 * @param {NodeJS.ProcessEnv} [env]
 */
export function assertDestructiveAllowed(connectionString, action, env = process.env) {
  const target = describeTarget(connectionString);
  const refuse = (reason) => {
    throw new DestructiveRefusal(
      `${action} refused against ${target.label}: ${reason}\n` +
      "Destructive test setup runs only against a local disposable database, " +
      "with PT_GLORY_ENV=dev|test and ALLOW_DESTRUCTIVE_DB_RESET=1.",
    );
  };

  // Checked first and never overridable: the Cloud project holds real research
  // data that no fixture can rebuild.
  if (isPilotProject(connectionString)) {
    refuse(
      `this is the PILOT Supabase project (${PILOT_PROJECT_REF}). ` +
      "No environment variable can authorize this",
    );
  }
  if (isCloudDatabase(connectionString)) {
    refuse("this is a Supabase Cloud database. No environment variable can authorize this");
  }

  const environment = (env.PT_GLORY_ENV ?? "").trim().toLowerCase();
  if (!environment) {
    refuse("PT_GLORY_ENV is not set, and an unset environment is never treated as dev");
  }
  if (!DISPOSABLE.has(environment)) {
    refuse(`PT_GLORY_ENV=${environment} is not a disposable environment`);
  }
  if ((env.ALLOW_DESTRUCTIVE_DB_RESET ?? "") !== "1") {
    refuse("ALLOW_DESTRUCTIVE_DB_RESET=1 is not set");
  }

  /*
   * A target the guard cannot read is a target it cannot vouch for. Missing or
   * malformed, it must refuse rather than fall through to "no host, no
   * objection" — the caller would then connect to whatever `pg` defaults to,
   * which is exactly the unexamined path this guard exists to close.
   */
  if (!target.host) {
    refuse("the database could not be identified from DATABASE_URL");
  }
  // The remaining risk is a non-Supabase remote host — a colleague's machine,
  // a staging box somebody wired up by hand.
  if (!LOCAL_HOST.test(target.host)) {
    refuse(`${target.host} is not a local database host`);
  }
}
