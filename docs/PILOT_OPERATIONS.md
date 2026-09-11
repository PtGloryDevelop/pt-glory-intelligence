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

### Changing a password

The app has no change-password screen. Until it does, the person sits at the
operator's machine and types their own:

```powershell
$env:PT_GLORY_ENV='pilot'; node --env-file-if-exists=.env.local scripts/pilot-set-password.mjs <email>
```

Hidden prompt, entered twice, at least 12 characters. It never takes the value
from argv or the environment, never prints it, never writes it anywhere — so the
operator never learns it either. A long run of digits (a phone or ID number)
draws a warning and needs `yes`. On success it proves the new password signs in
and removes that account's now-dead generated record from
`.env.pilot-users.local`.

Needs a real terminal (PowerShell or Windows Terminal). A piped or embedded
shell cannot hide keystrokes, so the script refuses rather than echo them.

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

### Second import, and what two runs unlocked

The same keyword, re-collected on 2026-09-10 with an identical scope
(`keyword_unordered`, TH, active): 500 ads, 206 pages, 481 assets queued.

| | 7 Sep | 10 Sep |
|---|---|---|
| ads | 631 | 500 |
| pages | 306 | 206 |

The category now holds 882 distinct ads and 351 pages — 631 + 500 minus the 249
that appear in both. A smaller second run does **not** mean the market shrank; it
means that collection loaded less of the list. The `completeness_claim` in every
export says so, and nothing in the product infers otherwise.

Keeping the scope identical matters: the workspace warns when two runs used
different queries, because a difference in counts would then be unattributable.

### The unusable assets are the source, not the archiver

All of them are CAROUSEL, DCO or DPA observations whose media is `cards` only —
no `images`, no `videos`. Across 94 such cards, **none** carries
`resized_image_url` or `original_image_url`; they hold `body`, `title`,
`cta_text`, `cta_type`, `link_url`, `link_description`, `video_hd_url` and
`video_sd_url`. There is no still to archive.

That was 3.17% of the first collection, against the 3.2% Phase 1 measured and
wrote into `lib/media/select.ts`; the second import added 19 more of the same
kind. `unusable` is the correct status — media exists but
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

## 6. Proving the pilot still tells the truth

Three read-only scripts. None of them writes anything a person would see, and
none uses the service-role key to make an assertion pass.

```bash
# every surface renders, at 1440 and 375, plus sign-out
PT_GLORY_ENV=pilot PILOT_SMOKE_EMAIL=… PILOT_SMOKE_PASSWORD=…   node --env-file-if-exists=.env.local scripts/pilot-smoke.mjs

# every number opens exactly the ads it counted, and the refusals refuse
PT_GLORY_ENV=pilot PILOT_PROOF_EMAIL=… PILOT_PROOF_PASSWORD=…   node --env-file-if-exists=.env.local scripts/pilot-evidence-proof.mjs

# the role contract: analyst/admin may, viewer may not, and neither reads the
# other's Watchlist. Creates and then removes only its own editorial rows.
PT_GLORY_ENV=pilot PILOT_PROOF_EMAIL=… PILOT_PROOF_PASSWORD=…   PILOT_PROOF_EMAIL_B=… PILOT_PROOF_PASSWORD_B=…   node --env-file-if-exists=.env.local scripts/pilot-role-proof.mjs
```

These are not a substitute for the DB and browser suites — they cover a fraction
of what those do. They exist because the suites cannot run at all right now (§1),
and because the deployed runtime is where a serialization or plumbing fault would
appear even with correct SQL behind it.

Run all three after any deployment.

### Snapshot truth, proven on real pilot data

With two runs of the same keyword, 249 ads appear in both and 20 of them were
observed with a different `collation_count` the second time. Ad
`1441020340962647` was seen as 1 on 7 Sep and 3 on 10 Sep:

- opened inside the 7 Sep dataset → **1**
- opened inside the 10 Sep dataset → **3**
- opened with no dataset → 3, the newest observation

The first dataset still totals 631 ads and 306 pages, unchanged. A report sent on
7 Sep opens today with the same numbers on it.

---

## 7. Failure recovery

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

## 8. Boundaries this pilot must keep

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

## 9. Backups

The pilot runs on the Supabase plan attached to project `hufzfbqfwusfiaywtnvy`.
**The platform's backup policy has not been verified** — free-tier projects have
limited or no point-in-time recovery, and this document will not claim a
capability nobody has checked. Confirm it in the dashboard with the account that
owns the project.

Rather than depend on that answer, take the recovery gap out of the equation:

| Layer | Comes back from | Needs a backup? |
|---|---|---|
| Schema | `supabase/migrations`, 34 files | no |
| Datasets, ads, observations | the original collector export files | no — **keep those files** |
| Archived previews | re-archival, only while source URLs live (~4 days) | after that, no |
| **Categories, Brands, mappings, Watchlists, roles** | **nothing** | **yes** |

The last row is the one that matters. Those are decisions people made; no export
contains them and no amount of re-importing recreates them.

```bash
PT_GLORY_ENV=pilot node --env-file-if-exists=.env.local scripts/pilot-backup.mjs
```

Writes a timestamped JSON to `backups/` (gitignored, mode 600) holding the
editorial layer plus a dataset manifest that says which export rebuilds which
dataset. Read-only, and deliberately not a dump of ads or media: those are large,
reproducible, and copying them would create a second uncontrolled copy of the
research data.

Run it after any session of real mapping work, and before any migration or
deployment that touches those tables. During the pilot, once a day is cheap.

**Restoring** is a manual job on purpose — a restore script that ran against the
wrong database would be the most expensive mistake available here. The file is
plain JSON; rebuilding from it means inserting categories, brands, mappings,
watch items and roles in that order.

---

## 10. Known limitations at pilot start

1. **DB and e2e suites cannot run** until a local Supabase stack exists — 18 DB
   files and 174 browser cases. Any fix is verified by lint, typecheck, unit
   tests and build only; say so plainly when reporting one. See §1.
2. **No custom domain.** The Vercel URL is the address.
3. **No email transport.** Accounts are created confirmed; there is no
   self-service password reset.
4. **No observability platform.** Vercel function logs, `net._http_response`,
   `cron.job_run_details` and the archive health endpoint are the whole toolkit.
5. **Historical Brand analytics are not built** — see `BRAND_MAPPING_V1.md` §8.
