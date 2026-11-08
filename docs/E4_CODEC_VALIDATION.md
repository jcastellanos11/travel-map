# E4.0 — Codec and runtime validation

Date: 2026-11-08. Baseline `0f399bd`/`main`; E3.5 committed. **Synthetic local
experiments only.** No user photographs, personal EXIF, cloud resources, database
connections, media endpoints or application configuration changes.

## Environment and reproducibility

| Capability | Observed version/result |
| --- | --- |
| OS/architecture | macOS, ARM64 |
| Node/npm | 24.21.0 / 11.19.0 |
| Sharp/libvips | 0.35.5 / 8.18.7 |
| libheif/libwebp/libpng | 1.23.5 / 1.6.0 / 1.6.58 |
| exifr | 7.1.3 |
| Wrangler / workerd / Miniflare | 4.156.0 / 1.20261023.1 / 5.20261023.3-beta; actual local workerd, compat 2026-10-30/nodejs_compat |
| macOS image utility | `/usr/bin/sips`, version 316 |
| Other tools | Python 3.9.6 present; Pillow, heif Python bindings, ImageMagick, ffmpeg, standalone vips/exiftool unavailable |
| Resources | ~207 GiB disk available at inspection; RAM inventory query was sandbox-denied, not established |

No dependency was installed. The experiment resolves existing isolated
`spikes/tools/node_modules`; production dependencies and all lockfiles are unchanged.
Sharp is Apache-2.0, exifr MIT; installed `@img/sharp-libvips-darwin-arm64` 1.3.4
declares **LGPL-3.0-or-later**. Transitive codec notices/SBOM, native decoder patching
and HEVC patent/distribution review remain required; no legal clearance or absence of
vulnerabilities is claimed. macOS system decoding is not a portable dependency.

From repository root, after existing application builds, run:

```sh
node spikes/e4-media/run-codecs.mjs
node --test spikes/e4-media/security.test.mjs spikes/e4-media/isolation.test.mjs
WRANGLER_LOG_PATH=spikes/e4-media/runs/workerd.log WRANGLER_SEND_METRICS=false node spikes/e4-media/run-workerd.mjs
node spikes/e4-media/manifest.mjs
```

The codec command generates fixtures and invokes sips; OS permission may be required.
Local workerd needs loopback permission. In this session the codec and workerd runs
used explicit sandbox approval where necessary, never a remote binding. No account
login or secrets are passed to probes. Harness state/cache is confined to ignored
`spikes/e4-media/runs/`; generated vector files are synthetic, not production assets.

## Fixtures and verification method

All image content is generated from our own deterministic pixels, not downloaded or
read from application photo assets. No third-party image licensing is involved.
`fixtures.mjs` and `containers.mjs` generate:

- 128×80 colored quadrants, alpha stripes, JPEG/PNG/WebP with injected EXIF GPS `(0,0)`,
  orientation, fictional date and `E40_SYNTHETIC_PRIVATE_METADATA` identity sentinel.
- Eight EXIF orientation variants; synthetic Display-P3 profile input; real two-frame
  WebP and APNG, 16-bit PNG, malformed EXIF, corrupt/truncated/container-tail cases.
- A valid compressed 50 MP PNG (145,876 encoded bytes representing 150,010,000 decoded
  scanline bytes); 9,000-pixel-wide panorama; valid PNGs padded with ancillary data
  to exactly 19,900,000, 20,000,000 and 20,000,001 bytes.
- HEIC encoded from our generated JPEG by sips. HEIF is the same actual HEVC payload
  with major brand changed to `mif1`, retaining compatible brands. This tests a real
  container variant, **not an independent HEIF camera/codec corpus**. Filenames alone
  are not evidence; brand bytes, decoding and original GPS presence are recorded.
- Deterministic 4000×3000 noise JPEG, 6,313,733 bytes, for resource observations.

For JPEG/PNG/WebP, establish source GPS using an independent exifr reader. exifr does
not recognize the complete WebP container here, so the independent RIFF parser
extracts its EXIF TIFF chunk before exifr inspection. Decode/orient/convert to sRGB
raw pixels, then feed fresh encoders. Independently inspect output container allowlists,
reject EXIF/XMP/IPTC/ICC/comments/unknown ancillary payloads and verify absent sensitive
metadata with exifr/Sharp plus sentinel checks. Decode all output variants. This
tests **archival, display and thumbnail**, not merely the display image.

JPEG output uses a strict baseline segment scanner, PNG verifies CRCs/allowed chunks,
WebP verifies RIFF structure/chunks/flags. PNG's non-identifying pHYs chunk may remain;
no location, user text or original metadata is retained. This is a constrained
verification strategy, not a universal forensic metadata parser or fuzz certification.

## Format compatibility matrix

| Input | Local Node Sharp | macOS decoder chain | Local Images emulator | Hosted Images |
| --- | --- | --- | --- | --- |
| JPEG | **Verified** decode, all safe variants | Not needed/tested separately | **Verified**, tiny fixture→64×40 WebP | **Blocked**: no approved cloud test |
| PNG | **Verified**, alpha preserved | Not needed/tested separately | **Verified**, alpha WebP | **Blocked** |
| WebP | **Verified**, alpha preserved | Not needed/tested separately | **Verified**, alpha WebP | **Blocked** |
| HEIC/HEVC | **Not supported** by installed decoder | **Partially verified**: synthetic decode→PNG→raw-barrier safe WebPs | **Not supported** in installed local decoder | **Blocked**, documented HEIC is not a successful test |
| HEIF/mif1 HEVC | **Not supported** by installed decoder | **Partially verified**, same HEVC payload/container variant only | **Not supported** | **Blocked**; broad HEIF coverage unverified |

Observed Node/local Images error: `Support for this compression format has not been
built in: HEVC (a suitable decoder plugin is libde265) (11.6003)`. A libheif version
or Sharp `heif` capability flag does not establish an HEVC decoder. Do not label the
format supported because AVIF shares a container family. [Sharp installation/codecs](https://sharp.pixelplumbing.com/install/)

The sips chain genuinely decoded both synthetic inputs and its reconstructed outputs
passed metadata stripping checks. It writes synthetic intermediate files and is
**not** approved for beta user processing: intermediate privacy, strict containment,
Linux portability, camera variants/HDR/depth/sequences, orientation and memory are
not established. Do not install or select an HEVC codec implicitly. Until the chosen
processor passes the full gate, HEIC/HEIF must be disabled/rejected in beta uploads
rather than retained unsanitized; this records a gate, not removal of the intended
format requirement.

Cloudflare documents HEIC input and 20 MB binding limits; actual hosted compatibility,
metadata behavior and boundary interpretation remain untested. The local emulator
failure cannot establish hosted failure, and the vendor format list cannot establish
our successful transformation. [Images limits/formats](https://developers.cloudflare.com/images/get-started/limits/)

## Codec results

Final `spikes/e4-media/codec-results.json`: **32 passed assertions, zero failed,
zero skipped.** Negative HEVC capability results are recorded in `formats`; the
32 passes do not mean 32 positive codec-support claims.

| Check | Actual result and limitation |
| --- | --- |
| GPS and other metadata | JPEG/PNG/WebP source GPS established; all three reconstructed variants pass allowlists and metadata/sentinel checks |
| Alternate archival | JPEG95 opaque / PNG alpha outputs also safe; tiny JPEG archival PSNR ~50.54 dB; alpha archival preserves decoded pixels exactly; not a subjective corpus-quality study |
| EXIF orientation | All eight orientations, expected dimensions and corner-pixel placement pass |
| Color and alpha | Display-P3→untagged sRGB max channel error 1 against reference; PNG/WebP transparency preserved |
| Signature vs declared MIME | Mismatch, SVG/active/vector content rejected; missing/octet-stream MIME still requires actual signature/full decode; AVIF not mistaken for HEIC |
| Corrupt/truncated input | Truncation/trailing payload and compressed corruption fail closed; malformed EXIF sample decodes to verified clean outputs rather than copied metadata |
| Animation/bit depth | Real distinct-frame WebP/APNG and 16-bit PNG rejected explicitly; no silent first-frame extraction or HDR conversion |
| Bomb | Valid 50 MP compressed input rejected by configured geometry budget before pixel processing; hostile-parser exploit resistance unverified |
| Panorama | Aspect ratio, derivative boxes and no enlargement verified at 9000-pixel width; broader panorama UX unverified |
| Actual input bytes | 19,900,000 and 20,000,000-byte PNG buffers accepted; 20,000,001 rejected; not an HTTP upload/cloud limit test |
| HEVC | Two OS-specific synthetic conversions pass, with native Node incompatibility reported separately |
| Resources/watchdog | Both 12 MP child profiles complete; intentionally hanging child killed by parent SIGKILL after 300 ms; not a real decoder-hang containment certification |

Unknown metadata extensions, XMP-only orientation, hostile ICC profiles, HDR/high-bit
depth, real iPhone/Android corpora, alpha-heavy maximum dimensions and prolonged
malformed-image fuzzing remain **Unverified**. Reject unsupported ambiguous cases;
do not infer a safe general parser from these synthetic cases. Sharp itself notes
that input-pixel limits rely on image header dimensions. [Constructor controls](https://sharp.pixelplumbing.com/api-constructor/)

### Resource observations — one local sample per profile

Node child `--max-old-space-size=128`, Sharp cache disabled, concurrency=1. RSS sampled
every 10 ms, process resourceUsage maximum also recorded. Native allocations are
outside V8's heap flag. No OS memory limit was imposed or proven.

| Profile on same 12 MP input | Wall time | Sampled peak RSS | Total stored bytes |
| --- | --- | --- | --- |
| Archival lossless WebP + display/thumb | 3065.36 ms | 749,912,064 (~715 MiB) | 33,650,076 |
| Archival JPEG95/4:4:4 + display/thumb | 701.51 ms | 358,825,984 (~342 MiB) | 17,661,812 |

Baseline RSS ~75 MB. CPU times ~3.11 s / 0.75 s. Archival output bytes respectively
30,966,260 / 14,977,996; display 2,670,814 and thumbnail 13,002. A 6.3 MB input
therefore need not store as 6.3 MB. Prefer the lower-cost JPEG/PNG profile subject to
quality/policy review. These are not p95, maximum-memory, cloud price or mobile UI
measurements. The 40 MP provisional cap needs explicit maximum-resource validation.

## Actual local workerd results

`spikes/e4-media/workerd-results.json`: **six passed assertions, zero failed/skipped**.
1. Cannot read the experiment's host marker.
2. No ImageDecoder/createImageBitmap APIs.
3. Native addon loading unavailable (`process.dlopen` not implemented).
4. `/tmp` write/read works in-request; next request has no previous file.
5. Local R2 four-byte known-length streaming put/head/get, conditional write rejection,
   unchanged contents and idempotent deletion.
6. Local Images converts JPEG/PNG/WebP to valid metadata-safe tiny WebPs.

R2/Images use **remote:false** and an isolated synthetic worker. No real bucket,
transform service, deployed Worker, billing or private-media authorization was tested.
Local image emulation uses Node Sharp outside the workerd isolate. Do not infer
native Sharp compatibility, hosted privacy or 20 MB binding success from it.

## Storage/reference security and application regressions

| Exact command (repository root unless noted) | Actual result |
| --- | --- |
| `node --test spikes/e4-media/security.test.mjs spikes/e4-media/isolation.test.mjs` | **20 passed, 0 failed/skipped**: 18 storage/reference + 2 isolation |
| `npm --prefix frontend run lint` | Exit 0 |
| `npm --prefix frontend run typecheck` | Exit 0 |
| `npm --prefix frontend test` | **200 passed, 0 failed/skipped**; includes generated DTO/OpenAPI drift check |
| `npm --prefix frontend run test:build` | Both normal production and local integration builds succeed; **3 passed, 0 failed/skipped** isolation tests |
| From `backend/`: `WRANGLER_LOG_PATH=.local/e40-check.log WRANGLER_SEND_METRICS=false npm run check > .local/e40-check-results.log 2>&1` | Lint/typecheck/dry-run build succeed; **40 passed, 0 failed/skipped**, including documentation/OpenAPI and actual local runtime tests |
| `git diff --check` | Exit 0 at final scope review |

Total final test/assertion results: **301 passed, zero failed/skipped** (243 application
regression/build checks + 58 PoC assertions/tests). Lint/typecheck/build are additionally
reported as commands, not counted as tests. Logs: frontend `.local/e40-*.log`, backend
`.local/e40-check-results.log`; PoC reports listed above and source/fixture hashes in
`spikes/e4-media/evidence-manifest.json`.

No PostgreSQL/Supabase integration rerun, database migration, authenticated browser
test or E4 private-media E2E was executed. No relevant application/SQL/provider code
changed; these historical suites are not reused as new native E4 evidence. Existing
frontend build tests cover production exclusion of development diagnostics. Additional
PoC isolation tests scan application sources/current artifacts for experiment imports
and marker strings, and confirm no production R2/Images binding was added.

### Failures and troubleshooting record

- First codec report (`codec-initial-results.json`) had **11 pass/15 fail**. Test
  verification initially passed a full WebP to exifr (unsupported by that reader),
  identical frames were optimized into a static image, and sandboxed sips failed.
  Fixed the independent WebP EXIF extraction and generated genuinely distinct frames;
  used explicit OS permission for synthetic sips processing. Expanded final checks
  to 32; do not erase the initial failures or claim that change enabled Node HEVC.
- Initial backend check inside the sandbox had **38 pass/2 fail**, caused by loopback
  EPERM in local runtime tests. Explicitly approved retry completed **40/40**. No
  application fix or network/security relaxation was made.
- A probe cache-confinement edit initially passed a URL object to `process.chdir`,
  producing ERR_INVALID_ARG_TYPE before runtime assertions. Corrected to a pathname
  and reran successfully (six checks). Wrangler's newly generated root cache was
  moved into ignored experiment storage; future probe state stays there.
- Native HEVC failures remain real capability failures, not fixed tests. Hosted
  verification is **Blocked** by the no-cloud constraint; resources/permissions would
  require separate approval, synthetic format corpus, safe output inspection and cost
  limits before any future sandbox execution.

## Feasibility gates

| Gate | Status | Required next evidence |
| --- | --- | --- |
| Local storage isolation | **Verified** for Node experiment; **Partially verified** Worker emulator | Production adapter bridge, restart/crash/disk-full behavior |
| JPEG/PNG/WebP decode/sanitize/WebP | **Verified** synthetic Node paths | Representative licensed/synthetic hostile corpus, exact maximum resource test |
| All-output GPS removal | **Verified** for tested reconstructions | Enabled runtime/provider corpus, no raw durable stages, cache/log inspection |
| HEIC/HEIF chosen portable decoder | **Not supported** installed Node/local emulator; macOS **Partially verified** | Portable licensed decoder or approved real Images test; keep disabled meanwhile |
| Native Sharp in workerd | **Not supported** | Separate processor boundary or verified hosted adapter |
| Memory/time hard containment | **Partially verified** measurements/watchdog | OS hard RSS/CPU/process limits, 40 MP/10-file contention/stress |
| Private application retrieval | **Unverified** proposal | Real HTTP+SQL+browser role/revocation/cache tests |
| Atomic quota and DB recovery | **Unverified** SQL design; reference mechanics **Verified** | Independent PostgreSQL connection races/fault injection |
| R2 migration compatibility | **Partially verified** interface/emulator | Approved cloud size/hash/conditional/latency/cost tests |
| Actual cloud usage/cost | **Blocked** | Separate sandbox/billing authorization, strict spend/cleanup plan |

E4.0 establishes a viable research direction and concrete blockers. It does not
authorize E4.1 or certify beta HEIC, production privacy or hosted performance.
