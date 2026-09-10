# PT Glory Intelligence — Pilot Operations

Operator's manual for the internal pilot. No secrets here; every credential
lives in Vercel's encrypted environment, in Supabase Vault, or in a gitignored
local file.

| | |
|---|---|
| **URL** | https://pt-glory-intelligence.vercel.app |
| **Purpose** | Internal pilot / staging. Real research data, small internal team. |
| **Hosting** | Vercel, project `pt-glory-intelligence`, scope `pt-glory` |
| **Database** | Supabase project `hufzfbqfwusfiaywtnvy`, region `ap-southeast-1` |
| **Environment label** | `PT_GLORY_ENV=pilot` |

---

## 1. DEV and PILOT are not the same thing

The Supabase project above **used to be** the destructive test database. It is
now the pilot, and the separation is enforced in code rather than remembered:

`scripts/destructive-guard.mjs` refuses every destructive path — fixture
truncation, the Playwright global setup, `migrate down`, the synthetic seed
script — unless **all** of:

1. `PT_GLORY_ENV` is `dev` or `test` (unset is a refusal, never a default)
2. `ALLOW_DESTRUCTIVE_DB_RESET=1`
3. the target is a **local** database

Condition 3 cannot be overridden. The pilot project ref and every
`*.supabase.co/.com/.in` host are refused before the environment variables are
even read, and the pilot is recognised through the pooler too — its hostname
names a region, and the project ref hides in the username.

**Consequence, and it is a real one:** the DB and end-to-end suites cannot run
at all — 18 DB files plus 174 Playwright cases across `chromium`, `p2` and `c3`.
They need Supabase's whole stack (Postgres **and** Auth **and** PostgREST,
because the app signs in through one and reads through the other), which means a
container runtime, which is not installed on the build machine.

Until that exists, any change is verified by `lint`, `typecheck`,
`check:imports`, the unit suites (277) and `build` — and nothing else. Say so
plainly when reporting a fix. What those five cannot check is precisely what the
missing suites cover: RLS boundaries, cross-user isolation, snapshot truth, and
whether a displayed count still matches its evidence.

**Deliberately accepted for the pilot**, on the reasoning that the deployed
commit passed the full suite before the cutover and the pilot is read-heavy.
Revisit before changing anything that touches RLS, role checks, or how a number
is counted. Podman Desktop and Rancher Desktop are lighter than Docker Desktop
and free without company-size conditions; Docker Engine under WSL2 needs no
desktop app at all.

`scripts/pilot-reset.mjs` is the deliberate inverse: it refuses *everything
except* the pilot, and takes the project ref typed out as confirmation. Two
scripts, two refusals, neither able to do the other's job.

---

## 2. What is deployed

Check what the team is actually looking at:

```bash
curl -s https://pt-glory-intelligence.vercel.app/api/version
```

```json
{"commit":"…","builtAt":"…","environment":"pilot","deployment":"vercel"}
```

The commit is passed in at build time (`--build-env PT_GLORY_COMMIT=…`) because
a CLI deploy uploads a directory rather than a git clone. If it ever reads
`unknown`, the deploy did not carry it — that is a wrong build to be debugging
against.

### Deploying

```bash
vercel deploy --prod --yes --build-env PT_GLORY_COMMIT="$(git rev-parse --short HEAD)"
```

Environment variables live in Vercel (Production scope), set once:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `MEDIA_ARCHIVE_TOKEN`,
`PT_GLORY_ENV=pilot`.

`ALLOW_DESTRUCTIVE_DB_RESET` is deliberately **not** set anywhere in Vercel.

`DATABASE_URL` uses the pooler in **transaction mode (port 6543)**: a serverless
invocation is short-lived, and session mode would hold a pooler slot per lambda.

### Migrations

```bash
npm run migrate up      # allowed against pilot — this is how it gets its schema
npm run migrate down    # refused against pilot, by design
```

Applied through `scripts/migrate.mjs`, tracked in `public.schema_migrations`.
The pilot is reproducible from the repository; nothing was built by hand.

---

## 3. Users and roles

```bash
PT_GLORY_ENV=pilot node --env-file-if-exists=.env.local \
  scripts/pilot-user.mjs <email> <viewer|analyst|admin>
```

Creates the account, confirms the email (no mail transport is configured, and an
unconfirmed account cannot sign in), assigns exactly one role in
`public.user_roles` — the table every RLS policy reads — and then proves the
account can sign in rather than assuming it.

The generated password is appended to `.env.pilot-users.local` (gitignored,
mode 600) and never printed. Hand it over, have the person change it, delete the
file.

| Role | May |
|---|---|
| viewer | read everything; keep their own Watchlist |
| analyst | + import; create and change Brand mappings |
| admin | + manage users |

One account per person. Sharing an admin login would make every RLS boundary
meaningless and every audit row a lie.

---

## 4. Importing real data

```bash
PT_GLORY_ENV=pilot node --env-file-if-exists=.env.local --conditions=react-server \
  --experimental-strip-types scripts/pilot-import.mjs <export.json> "<category>" "<dataset name>"
```

Same three steps as the HTTP route, in the same order, with the same functions:
validate and normalize → commit in one transaction → enqueue media on a separate
connection. It deliberately does **not** drain the queue; that is the
scheduler's job, and doing it by hand would hide whether automatic archival
works.

Analysts can also import through the UI, which is the normal path.

**Source URLs expire in roughly 4 days.** Import promptly after export or the
creative cannot be archived — the text still imports, the images do not.

---

## 5. Media archive (C1.9)

```
pg_cron  */10 * * * *
  → run_media_archive_drain()      SECURITY DEFINER, no app role may execute it
    → Vault: media_archive_url + media_archive_token
      → pg_net POST  <url>/api/media/archive/run   Bearer <token>
        → drainArchiveQueue()      fetch CDN → poster → private bucket
```

Nothing about this runs on a developer's machine, and there is no localhost
anywhere in it.

### Health

```bash
curl -s -X POST -H "Authorization: Bearer $MEDIA_ARCHIVE_TOKEN" \
  -H 'content-type: application/json' -d '{"limit":1}' \
  https://pt-glory-intelligence.vercel.app/api/media/archive/run
```

Returns `stats` for that run and `health` for the whole queue: `pending`,
`archived`, `none`, `unusable`, `failedRetryable`, `failedTerminal`,
`oldestPendingAgeMinutes`, `earliestExpiry`, `expiringWithin24h`,
`lastAttemptAt`.

### Is the scheduler alive?

```sql
select id, status_code, error_msg, created
  from net._http_response order by id desc limit 5;

select runid, status, start_time
  from cron.job_run_details order by runid desc limit 5;
```

**Read `net._http_response`, not the cron status.** On 2026-09-08 every cron run
reported `succeeded` while pg_net recorded `Couldn't connect to server` — the
scheduler fired perfectly into a URL that did not exist. Cron status says the
job ran; only the response says anything was delivered.

### First real import, for reference

The 631-ad import of 2026-09-07 queued 611 assets and the scheduler drained
every one of them without a manual call:

```
archived 611 · pending 0 · unusable 20 · failedRetryable 0 · failedTerminal 0
```

It took about 90 minutes of ticks, including the ten minutes lost to a
deliberately induced failure. Nothing was lost and nothing needed re-importing.

### The 20 unusable assets are the source, not the archiver

All 20 are CAROUSEL (14) or DCO (6) observations whose media is `cards` only —
no `images`, no `videos`. Across 94 such cards, **none** carries
`resized_image_url` or `original_image_url`; they hold `body`, `title`,
`cta_text`, `cta_type`, `link_url`, `link_description`, `video_hd_url` and
`video_sd_url`. There is no still to archive.

That is 3.17% of the collection, against the 3.2% Phase 1 measured and wrote
into `lib/media/select.ts`. `unusable` is the correct status — media exists but
policy cannot turn it into a still — and it is distinct from `none`.
`failure_reason` is null because these were never attempted: the status is
decided when the row is queued, not after a failure.

Archiving them would mean downloading video to extract a frame, and `link_url`
is advertiser-supplied and permanently barred from the fetch path. No fix is
required or wanted.

### Batch size (found in pilot)

One asset takes about 1.6 seconds on this deployment. The original batch of 200
therefore ran ~5 minutes while pg_net stops waiting at 120 seconds: archival
worked, but every loaded tick recorded a timeout instead of an HTTP status,
which left the one table that proves delivery unable to do so. Migration `0034`
sizes a batch to 50 — about 80 seconds — so each tick reports its own result.

At one tick per ten minutes that is 300 assets an hour, far ahead of the ~34
hours a fresh signed URL survives. A large first import simply takes a few hours
of ticks, visible the whole way.

---

## 6. Failure recovery

| Symptom | Look at | Likely cause |
|---|---|---|
| Team sees stale numbers | `/api/version` | an old deploy is live |
| Images missing, placeholders shown | `health.pending`, `earliestExpiry` | queue behind, or URLs expired before archival |
| `net._http_response` shows timeouts | batch size, route `maxDuration` | a tick cannot finish inside the window |
| `net._http_response` shows connect errors | `vault.decrypted_secrets` names | the URL moved, Vault still points at the old one |
| Import rejected | the response `reason` | wrong export product, or a malformed file |
| A signed-in user sees nothing | `public.user_roles` | account exists without a role row |

A missed tick loses no work: the queue is claimed per item, and whatever a run
does not reach stays pending for the next one. Re-importing is never required to
recover archival.

---

## 7. Boundaries this pilot must keep

- **Watchlist is manual.** No evaluator, no schedule, no notification, no event
  history. Numbers are computed when somebody opens the page. Automatic
  monitoring stays blocked until continuous collection exists.
- **Brand mapping is editorial.** People decide; nothing infers. Mappings are
  intervals, so a correction closes one and opens the next — history is never
  rewritten. Brands are archived, never deleted.
- **Snapshot truth.** A dataset shows the run it was imported from, for ever.
  Later collections never change an existing dataset's numbers.
- **No performance metrics anywhere.** No spend, reach, impressions,
  engagement, CTR, CPC, CPA, ROAS, conversions, or true market share. The source
  does not carry them and the product does not guess.

---

## 8. Backups

The pilot runs on the Supabase plan attached to project `hufzfbqfwusfiaywtnvy`.
**Confirm the backup policy in the dashboard before treating any pilot data as
durable** — free-tier projects have limited or no point-in-time recovery, and
this document will not claim a capability that has not been verified.

What is reproducible without a backup: the schema (from `supabase/migrations`),
and any dataset whose original export file still exists. What is **not**:
editorial work — Brand mappings, Watchlists, categories, and the archived media
whose source URLs have since expired. Keep the original collector exports.

---

## 9. Known limitations at pilot start

1. **DB and e2e suites cannot run** until a local Supabase stack exists — 18 DB
   files and 174 browser cases. Any fix is verified by lint, typecheck, unit
   tests and build only; say so plainly when reporting one. See §1.
2. **No custom domain.** The Vercel URL is the address.
3. **No email transport.** Accounts are created confirmed; there is no
   self-service password reset.
4. **No observability platform.** Vercel function logs, `net._http_response`,
   `cron.job_run_details` and the archive health endpoint are the whole toolkit.
5. **Historical Brand analytics are not built** — see `BRAND_MAPPING_V1.md` §8.
