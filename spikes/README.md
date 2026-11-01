# Isolated architecture PoC: phases 0 and 1

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
