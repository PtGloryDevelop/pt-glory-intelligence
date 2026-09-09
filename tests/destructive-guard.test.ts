import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DestructiveRefusal, PILOT_PROJECT_REF, assertDestructiveAllowed,
  describeTarget, isCloudDatabase, isPilotProject,
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
  // A guard nothing calls is a comment. These are the paths that can wipe or
  // fabricate data, and each one has to ask permission before its first write.
  const guarded = [
    "tests/db/helpers.ts",
    "e2e/db.ts",
    "e2e/global.setup.ts",
    "scripts/seed-explorer-dataset.mjs",
    "scripts/migrate.mjs",
  ];
  for (const file of guarded) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /assertDestructiveAllowed\(/, `${file} must call the guard`);
  }

  // `migrate up` is how PILOT gets its schema, so only `down` is guarded.
  const migrate = readFileSync("scripts/migrate.mjs", "utf8");
  const downBlock = migrate.slice(migrate.indexOf('command === "down"'));
  assert.match(downBlock.slice(0, 400), /assertDestructiveAllowed\(/);
});
