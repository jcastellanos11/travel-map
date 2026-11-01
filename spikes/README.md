# Isolated architecture PoC: reference and native local experiments

## Current native local run (2026-11-01)

The historical reference harness below is retained. Actual local Workers/D1 and
Workers/PostgreSQL adapters now live in the candidate directories; neither is a
production backend. See `docs/POC_RESULTS.md` for the current authoritative result.

- `tools/package.json` and `package-lock.json` pin isolated tooling; reproduce with
  `npm ci --prefix spikes/tools` from the repository root.
- `shared/generate-native.mjs` generates disposable D1/PostgreSQL schemas from the
  same fixture. SQL triggers implement atomic quota/operation/asset transitions.
- `shared/native-handler.mjs` is a **loopback-only experimental HTTP interface**,
  including deliberately privileged `/harness/*` setup controls. Never deploy it.
- `shared/native-tests.mjs d1|postgres`: 22 parity integration tests per candidate.
  These use actual local bindings/connections, not the reference SQLite adapter.
- `tools/supabase-tests.mjs`: actual LOCAL Auth/JWKS/PostgREST/RLS tests. Synthetic
  password grants are only a test transport, not the production Google flow.
- `tools/worker-jwt-test.mjs`, `session-revocation-test.mjs`, `expiry-check.mjs`:
  signature/session lifecycle integration and negative controls.
- `tools/images-binding-test.mjs d1|postgres`: local Images/R2 probes including
  actual 19.9/20/20+ MB PNG bytes. The emulator rejects HEIC but accepts 20+ MB;
  neither outcome proves Cloudflare's deployed service behavior.
- `tools/d1-recovery.mjs`, `postgres-recovery.mjs`, `supabase-restart-check.mjs`:
  local export/import, object-state copy, pg_dump/restore and restart checks.
- Native Supabase's service versions/checksums are pinned in
  `cloudflare-supabase/native-supabase/supabase/supabase.lock`. Its experimental
  native runtime uses actual ARM64 PostgreSQL/Auth processes. **Docker installation
  remains blocked by host sudo interaction; no container test was substituted.**
- Credentials, raw runtime logs, databases, dumps and stack status live only in
  ignored `.dev.vars`, `.state`, `.wrangler`, or `runs/` paths. Never copy them into
  reports or Git. Supabase's host cache/preferences also contain local runtime state.

Native test time/expiry values are injected logical clocks. Scenario `namespace`
values create independent disposable ledgers; they are not production per-user
quota semantics. Mock sessions remain available for parity tests. The B bearer
path separately verifies local Supabase JWTs and maps subjects to fixture actors.
Its optional live session check demonstrates logout revocation at additional cost;
no production session strategy is selected.

The scripts expect services already initialized/running. Recovery uses independent
restore state/databases, and the PostgreSQL restore script uses a fixed disposable
restore DB name: do not rerun it over an already populated restore DB without an
explicit scoped reset. Do not run destructive commands against unrelated state.

## Historical reference-only harness

This is disposable experiment code. It is not a backend, HTTP API, migration,
authentication library, D1 adapter, or PostgreSQL emulator. It must never be
deployed or imported by the frontend/production backend.

`docs/POC_PLAN.md` is the source of PoC IDs; its numbering differs from the
shorter PoC list in `docs/ARCHITECTURE.md`. Results use the plan's numbering.

## Reproduce without installing dependencies

From the repository root, with the observed Node 24 runtime:

```sh
node spikes/shared/probe.mjs
node --test --test-reporter=tap spikes/shared/experiments.test.ts > spikes/evidence/tests.tap
python3 spikes/shared/media_fixture.py
```

Run the probe before redirecting test output: it creates the evidence folder.
Node's native TypeScript stripping and built-in `node:test`, `node:sqlite`,
assertions and child processes are used. No npm package is needed. SQLite support
and native type stripping are runtime prerequisites; another Node release may
emit experimental warnings or require compatible flags.

The media command needs installed macOS `sips` and Python 3. It records a blocked
outcome if the codec is absent/fails. Check `media-fixture.json`, not only the
script exit code. This environment required explicit permission to run the local
encoder outside the sandbox because its IOSurface access failed inside it. A
successful fixture run does not exercise Cloudflare Images, EXIF extraction for
product suggestions, GPS removal from a derivative, or real iPhone media.

## Layout and evidence

- `shared/fixtures.json`: synthetic identities, project memberships, visits,
  places, photos, size hypotheses and failed/intentional duplicate upload cases.
- `shared/scenarios.json`: independent expected outcomes and deferred decisions.
- `shared/policy.ts`: mock-session reference permission evaluator. Not secure
  authentication: fixture session labels are intentionally predictable.
- `shared/sqlite-reference.ts`: small SQLite ledger using conditional quota
  updates, constraints, unique operation/file/user keys and local transactions.
- `shared/concurrent-child.ts`: separate OS processes synchronized with an IPC
  barrier. Includes an intentionally unsafe negative control on a separate table.
- `shared/experiments.test.ts`: policy, scope, process races, rollback and upload
  replay assertions. No network sockets or cloud requests.
- `shared/media_fixture.py`: synthetic RGB TIFF/GPS generator and local HEIC
  encoder/decoder probe, with an independent small TIFF GPS parser.
- `cloudflare-only/` and `cloudflare-supabase/`: candidate-specific capability
  records and blocked native experiments; neither silently substitutes SQLite
  reference results for candidate validation.
- `fixtures/`: generated synthetic files only; no personal images.
- `evidence/`: environment/document hashes, TAP, state observations, codec logs
  and initial failure records. Reruns overwrite latest evidence, not historical
  failures. `tests.tap` contains timing noise and OS process IDs vary on rerun.
- `runs/`: ignored disposable SQLite databases created per test run. Nothing
  connects to an existing database. Only stores created here are mutated.

The policy and ledger experiments are separate primitives: the ledger trusts an
already-authorized user/visit supplied by its caller. No request-level atomic
authorization-to-quota integration is implemented or proven. Asset rows are
metadata only, with no object store. A photo becomes reference-ready only when
both synthetic original/display asset byte counts are committed; actual object
existence, file sniffing, storage cleanup and processing are not verified.

The local SQLite transaction uses `BEGIN IMMEDIATE`; it is deliberately not
presented as code runnable in D1. Translating it into D1 binding operations or a
PostgreSQL transaction requires new candidate-native experiments. Decimal byte
limits are test hypotheses. The schema is disposable and incomplete.

No auth secrets, credentials, global tools, project dependencies, cloud
resources, deployed endpoints, final architecture, or production integration
are created. See [POC_RESULTS](../docs/POC_RESULTS.md) for the comparison, blockers
and exact limits on the evidence.
