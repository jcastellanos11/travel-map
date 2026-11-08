# E4.0 isolated media research

Run date: 2026-11-08. Repository baseline: `0f399bd` on `main` (E3.5 committed).
This is not an upload API, production processor, authentication system or database adapter.
Nothing here is imported by frontend/backend application code. No cloud account, credentials,
personal media, database connection or network image source is used.

## Reproduction

From the repository root, using existing Node 24 and the already installed isolated
`spikes/tools/node_modules` dependencies:

```sh
node spikes/e4-media/run-codecs.mjs
node --test spikes/e4-media/security.test.mjs spikes/e4-media/isolation.test.mjs
WRANGLER_LOG_PATH=spikes/e4-media/runs/workerd.log WRANGLER_SEND_METRICS=false node spikes/e4-media/run-workerd.mjs
```

Run codecs before workerd: it generates its synthetic input vectors. The codec command
also invokes macOS `/usr/bin/sips`; an OS/sandbox permission failure is a blocker for
that experiment, not successful HEVC support. The workerd harness needs permission
to bind loopback ports. Both Images and R2 bindings explicitly use `remote:false`.
Wrangler cache/state and generated files remain under the ignored `runs/` directory.
The isolation tests expect current frontend/backend build artifacts; run the existing
build commands first. They never inspect application environment files.

## Inventory and evidence

| Files | Responsibility |
| --- | --- |
| `deps.mjs` | Resolve existing isolated Sharp/exifr dependencies; no installation |
| `containers.mjs`, `fixtures.mjs` | Construct synthetic EXIF/GPS/ICC, image containers, APNG and compressed large-pixel fixtures; independently audit output containers |
| `processor.mjs` | Experimental decode → oriented sRGB raw pixels → fresh encoders, provisional limits |
| `processor-child.mjs`, `run-codecs.mjs` | Codec checks, alternative archival profiles, RSS/CPU observations and watchdog |
| `storage.mjs` | Node-only private filesystem adapter experiment |
| `reference-model.mjs` | In-memory quota/lifecycle/authorization reference model; NOT SQL security evidence |
| `security.test.mjs`, `isolation.test.mjs` | Filesystem, reference security and application/build separation assertions |
| `probe-worker.mjs`, `run-workerd.mjs` | Actual local workerd capabilities; local R2/Images emulator probes only |
| `codec-results.json` | Final 32 passed assertions, format failures and resource observations |
| `codec-initial-results.json` | Preserved first run: 11 passes/15 failures, explained in codec validation |
| `security-results.txt` | Final 20 passed tests (18 security/reference + two isolation) |
| `workerd-results.json` | Final six passed assertions; HEVC rejection reported separately |
| `evidence-manifest.json`, `manifest.mjs` | Reproducible source/report and synthetic fixture SHA-256 inventory |

Fixtures are generated from our own colored pixels, fictional GPS `(0,0)` and a
synthetic metadata sentinel. HEIF uses a real `mif1` container-brand variant of the
generated HEVC image, not an independently sourced camera corpus. No external image
license or personal photograph is involved. Test source is project-authored; no third-party
fixture has been copied into the repository.

Dependencies: Sharp 0.35.5 (Apache-2.0), exifr 7.1.3 (MIT), Wrangler 4.156.0;
installed ARM64 libvips package 1.3.4 declares LGPL-3.0-or-later. See installed
packages for transitive notices; this is not a complete SBOM or patent clearance.
No dependencies, manifests or lockfiles were changed. `sips` is a macOS facility,
not a portable/bundled beta processor.

Generated raw synthetic inputs may contain deliberately injected metadata. They are
private test fixtures, not a design allowing durable unsanitized user originals.
`runs/` is Git-ignored; it can be removed later only as a scoped experiment cleanup.
Do not point these tools at an arbitrary directory or user photographs.

See the four `docs/E4_*` documents for recommendations, approval gates and limits
of the evidence. Passing reference-model checks does not establish PostgreSQL quota
concurrency, real media authorization, cloud codec compatibility or production durability.
