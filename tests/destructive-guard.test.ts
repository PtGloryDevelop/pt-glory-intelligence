import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  DestructiveRefusal, PILOT_PROJECT_REF, assertDestructiveAllowed,
  assertSupabaseTargetAllowed, describeTarget, isCloudDatabase, isPilotProject,
} from "../scripts/destructive-guard.mjs";

/**
 * The guard that stands between `truncate ... cascade` and a real database.
 *
 * Every case here is written from the same assumption: the person running the
 * command believes they are pointed at a fixture database. They are wrong, and
 * nothing in the connection string tells them so. These tests prove the refusal
 * happens anyway.
 */

const LOCAL = "postgresql://postgres:pw@127.0.0.1:54322/postgres";
const PILOT_DIRECT = `postgresql://postgres:pw@db.${PILOT_PROJECT_REF}.supabase.co:5432/postgres`;
const PILOT_POOLER =
  `postgresql://postgres.${PILOT_PROJECT_REF}:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`;
const OTHER_CLOUD = "postgresql://postgres:pw@db.someotherref.supabase.co:5432/postgres";

type Env = Record<string, string | undefined>;
const dev: Env = { PT_GLORY_ENV: "dev", ALLOW_DESTRUCTIVE_DB_RESET: "1" };

const refusal = (connection: string | undefined, env: Env) => {
  try {
    assertDestructiveAllowed(connection, "reset", env);
  } catch (error) {
    assert.ok(error instanceof DestructiveRefusal, "must be a DestructiveRefusal");
    return (error as Error).message;
  }
  return assert.fail("expected a refusal");
};

test("a local database with both switches on is allowed", () => {
  assertDestructiveAllowed(LOCAL, "reset", dev);
  assertDestructiveAllowed(LOCAL, "reset", { ...dev, PT_GLORY_ENV: "test" });
  assertDestructiveAllowed("postgresql://postgres:pw@localhost:54322/postgres", "reset", dev);
});

test("an unset environment is a refusal, never a default", () => {
  // The failure mode this exists for: a shell with no PT_GLORY_ENV at all,
  // which used to be indistinguishable from a development machine.
  assert.match(refusal(LOCAL, { ALLOW_DESTRUCTIVE_DB_RESET: "1" }), /PT_GLORY_ENV is not set/);
  assert.match(refusal(LOCAL, {}), /PT_GLORY_ENV is not set/);
});

test("only dev and test are disposable", () => {
  for (const environment of ["pilot", "staging", "production", "prod", "PILOT "]) {
    const message = refusal(LOCAL, { ...dev, PT_GLORY_ENV: environment });
    assert.match(message, /not a disposable environment/, environment);
  }
});

test("the opt-in switch has to be set on purpose", () => {
  assert.match(
    refusal(LOCAL, { PT_GLORY_ENV: "test" }),
    /ALLOW_DESTRUCTIVE_DB_RESET=1 is not set/,
  );
  // Nearly-right values are still refused: this is a switch, not a hint.
  for (const value of ["", "0", "true", "yes"]) {
    assert.match(
      refusal(LOCAL, { PT_GLORY_ENV: "test", ALLOW_DESTRUCTIVE_DB_RESET: value }),
      /ALLOW_DESTRUCTIVE_DB_RESET=1 is not set/,
    );
  }
});

/* ------------------------------------------------------- the unoverridable */

test("the pilot project is refused however the environment is set", () => {
  for (const connection of [PILOT_DIRECT, PILOT_POOLER]) {
    // Both switches on, environment claiming to be dev — and it still refuses.
    const message = refusal(connection, dev);
    assert.match(message, /PILOT Supabase project/);
    assert.match(message, /No environment variable can authorize this/);
    assert.ok(isPilotProject(connection));
  }
});

test("the pooler username is checked, not only the hostname", () => {
  // The pooler host names a region, not a project; the project ref hides in the
  // username. A host-only check would wave this through.
  assert.ok(!PILOT_POOLER.includes(`${PILOT_PROJECT_REF}.supabase`));
  assert.ok(isPilotProject(PILOT_POOLER), "the ref is in the username here");
});

test("any Supabase Cloud database is refused, not just the known one", () => {
  const message = refusal(OTHER_CLOUD, dev);
  assert.match(message, /Supabase Cloud database/);
  assert.match(message, /No environment variable can authorize this/);
  assert.ok(isCloudDatabase(OTHER_CLOUD));
  assert.ok(!isCloudDatabase(LOCAL));
});

test("a remote host that is not Supabase is still not local", () => {
  const message = refusal("postgresql://postgres:pw@db.example.internal:5432/postgres", dev);
  assert.match(message, /is not a local database host/);
});

test("a target the guard cannot read is refused, not waved through", () => {
  // Falling through here would hand the caller to whatever `pg` defaults to —
  // the unexamined path this guard exists to close.
  assert.match(refusal(undefined, dev), /could not be identified/);
  assert.match(refusal("", dev), /could not be identified/);
  assert.match(refusal("not-a-url", dev), /could not be identified/);
});

/* -------------------------------------------------------------- the message */

test("a refusal names the database without leaking the credential", () => {
  const secret = "sup3r-secret-password";
  const connection = `postgresql://postgres:${secret}@db.${PILOT_PROJECT_REF}.supabase.co:5432/postgres`;
  const message = refusal(connection, dev);

  assert.ok(!message.includes(secret), "the password must never reach an error message");
  // ...but the message still has to be actionable.
  assert.match(message, new RegExp(PILOT_PROJECT_REF));
  assert.match(message, /reset refused/);

  const described = describeTarget(connection);
  assert.equal(described.host, `db.${PILOT_PROJECT_REF}.supabase.co`);
  assert.equal(described.label, `db.${PILOT_PROJECT_REF}.supabase.co/postgres`);
  assert.ok(!JSON.stringify(described).includes(secret));
});

/* ------------------------------------------------------------ the callers */

test("every destructive path calls the guard", () => {
  /*
   * A list of guarded files is only as good as the memory of whoever last
   * added a file. This scans instead.
   *
   * Found the hard way: the previous version of this test named five files and
   * passed, while tests/db/rls.test.ts built its own pg.Client and inserted
   * into auth.users, and tests/db/auth-chain.test.ts created real accounts over
   * HTTPS with the service-role key. Both ran against the PILOT on a normal
   * `npm test`. Neither was on the list, so the list said everything was fine.
   */
  const GUARD_SYMBOLS = /assertDestructiveAllowed\(|assertSupabaseTargetAllowed\(|isPilotProject\(/;
  // Reaching the database through a helper that guards is guarding.
  const GUARDED_HELPERS = /from "\.\/helpers\.ts"|from "\.\.\/helpers\.ts"|from "\.\/db"|from "\.\/db\.ts"/;
  // Builds a client that answers to no RLS policy.
  const OPENS_A_DATABASE = /new pg\.(Client|Pool)\(|createClient\(/;

  /*
   * The pilot-* scripts are the intended, deliberate route to the Cloud project.
   * Each one refuses unless PT_GLORY_ENV=pilot AND isPilotProject(DATABASE_URL),
   * which is the opposite test from the one above and is checked separately.
   */
  const PILOT_OPERATIONS = /^pilot-/;

  /*
   * One more deliberate cloud path: archive-schedule-config writes the
   * scheduler's credentials into Supabase Vault. It is an operations script run
   * by hand once per environment, and it destroys no research data — it sets
   * two secrets. Named here so the exemption is a decision, not a gap.
   */
  const OPERATIONS = new Set(["archive-schedule-config.mjs"]);

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return /\.(ts|mjs|js)$/.test(entry.name) ? [path] : [];
    });

  const unguarded: string[] = [];
  for (const file of [...walk("tests"), ...walk("e2e"), ...walk("scripts")]) {
    const name = file.split(/[/\\]/).at(-1) ?? "";
    if (PILOT_OPERATIONS.test(name) || OPERATIONS.has(name)) continue;
    if (file.includes("destructive-guard")) continue;
    const source = readFileSync(file, "utf8");
    if (!OPENS_A_DATABASE.test(source)) continue;
    if (GUARD_SYMBOLS.test(source) || GUARDED_HELPERS.test(source)) continue;
    unguarded.push(file);
  }

  assert.deepEqual(
    unguarded, [],
    `these open a database without asking the guard first: ${unguarded.join(", ")}`,
  );

  // `migrate up` is how PILOT gets its schema, so only `down` is guarded.
  const migrate = readFileSync("scripts/migrate.mjs", "utf8");
  const downBlock = migrate.slice(migrate.indexOf('command === "down"'));
  assert.match(downBlock.slice(0, 400), /assertDestructiveAllowed\(/);
});

/* --------------------------------------------- the HTTPS door to the same data */

/**
 * A Supabase project URL plus a service-role key is a second way into the same
 * rows, and it never touches DATABASE_URL. These cases mirror the Postgres ones
 * exactly, because the consequence is the same.
 */

const LOCAL_PROJECT = "http://127.0.0.1:54321";
const PILOT_PROJECT = `https://${PILOT_PROJECT_REF}.supabase.co`;
const OTHER_CLOUD_PROJECT = "https://someotherref.supabase.co";
const OPEN = { PT_GLORY_ENV: "test", ALLOW_DESTRUCTIVE_DB_RESET: "1" };

test("a local Supabase project with both switches on is allowed", () => {
  assert.doesNotThrow(() => assertSupabaseTargetAllowed(LOCAL_PROJECT, "seed", OPEN));
});

test("the pilot project is refused over HTTPS however the environment is set", () => {
  for (const env of [OPEN, { PT_GLORY_ENV: "pilot", ALLOW_DESTRUCTIVE_DB_RESET: "1" }, {}]) {
    assert.throws(
      () => assertSupabaseTargetAllowed(PILOT_PROJECT, "create users", env),
      (error: Error) => error instanceof DestructiveRefusal
        && error.message.includes(PILOT_PROJECT_REF),
    );
  }
});

test("any Supabase Cloud project is refused, not just the known one", () => {
  assert.throws(
    () => assertSupabaseTargetAllowed(OTHER_CLOUD_PROJECT, "create users", OPEN),
    DestructiveRefusal,
  );
});

test("a local Supabase project still needs both switches", () => {
  assert.throws(
    () => assertSupabaseTargetAllowed(LOCAL_PROJECT, "seed", { PT_GLORY_ENV: "test" }),
    /ALLOW_DESTRUCTIVE_DB_RESET/,
  );
  assert.throws(
    () => assertSupabaseTargetAllowed(LOCAL_PROJECT, "seed", { ALLOW_DESTRUCTIVE_DB_RESET: "1" }),
    /PT_GLORY_ENV is not set/,
  );
  assert.throws(
    () => assertSupabaseTargetAllowed(LOCAL_PROJECT, "seed", {
      PT_GLORY_ENV: "pilot", ALLOW_DESTRUCTIVE_DB_RESET: "1",
    }),
    /not a disposable environment/,
  );
});

test("an unreadable Supabase URL is refused, not waved through", () => {
  assert.throws(
    () => assertSupabaseTargetAllowed(undefined, "seed", OPEN),
    /could not be identified/,
  );
  assert.throws(
    () => assertSupabaseTargetAllowed("not-a-url", "seed", OPEN),
    /could not be identified/,
  );
});
