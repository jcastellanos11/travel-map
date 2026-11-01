# Travel Map — Next Technical Decision Proposals

Date: 2026-11-01. Status: **draft for architecture review; no implementation or cloud execution authorized by this document**.

## 1. Scope, sources and evidence status

Reviewed [PRD](PRD.md), [DATA_MODEL](DATA_MODEL.md), [AUTHORIZATION_MATRIX](AUTHORIZATION_MATRIX.md), [ARCHITECTURE](ARCHITECTURE.md), [POC_PLAN](POC_PLAN.md) and the latest [POC_RESULTS](POC_RESULTS.md). The PRD contains approved product requirements; the architecture document explicitly remains a comparison draft, not an approved stack. These proposals do not resolve ADR-001 through ADR-004 or change product scope.

Labels used below:

- **Verified — local:** recorded repository experiments, not hosted-provider guarantees.
- **Verified — documentation:** current primary-source documentation, checked on this date; not execution evidence.
- **Recommendation:** proposed design or future experiment requiring review.
- **Cost assumption:** illustrative workload/rate calculation, not a quote or measured bill.
- **Requires validation:** unresolved behavior or acceptance condition.

### Evidence carried forward; no tests repeated

| Verified — local | Evidence and limitation |
|---|---|
| Workers/D1 and Workers/PostgreSQL each passed 22/22 equivalent integration cases. | [D1 results](../spikes/evidence/native/d1-results.json), [PostgreSQL results](../spikes/evidence/native/postgres-results.json). No remote database guarantees follow. |
| Local Supabase Auth/RLS passed 11/11; Worker JWT integration passed 3/3. | [Supabase results](../spikes/evidence/native/supabase-results.json), [Worker JWT results](../spikes/evidence/native/worker-jwt-results.json). Synthetic password grants, not Google OAuth. |
| JWT-only read remained successful after logout: 200 → logout 204 → 200. | [Negative control](../spikes/evidence/native/session-jwt-only.json). Its `pass` means the weakness was reproduced. |
| A live local Auth `/user` check denied the next read: 200 → logout 204 → 404. | [Live-check experiment](../spikes/evidence/native/session-live-check.json). Hosted revocation semantics remain unverified. |
| Local HEIC decoding failed; TIFF → WebP removed inspected GPS/EXIF/XMP. | [Media findings](POC_RESULTS.md#6-images-metadata-limits-and-private-objects). Neither establishes cloud HEIC conversion or universal metadata removal. |
| Actual 19,900,000 / 20,000,000 / 20,000,001-byte padded PNGs all passed the local simulator. | Same report. Tiny decoded images with ancillary padding do not represent camera-image processing demand or cloud limits. |

## 2. Proposal A — Authentication and session security

### 2.1 Required security contract

**Recommendation:** define immediate logout as follows: once revocation is durably acknowledged, subsequent private requests must consult authoritative state and deny the revoked session. Apply this to API data, aggregates, originals and derivatives across Worker instances. Membership removal must independently deny the next request for that scope, even while the login session remains valid. Already delivered bytes and requests authorized before revocation cannot be recalled.

Use current domain authorization for every strategy. Project membership, trip-only membership, original-download permissions, account state and resource lifecycle are not durable permissions embedded in a JWT. Authorship/quota responsibility alone does not preserve access after membership loss. This preserves the distinctions in [the authorization matrix](AUTHORIZATION_MATRIX.md#5-matriz-de-fotografías-y-medios).

**Verified — documentation:** Supabase access tokens can remain valid until expiry after logout. Supabase documents checking the JWT's `session_id` against `auth.sessions` for stronger post-signout guarantees. Session timeouts are not necessarily proactively enforced by row deletion. A production check must account for the applicable session policy, not merely an arbitrary row's existence. See [sessions](https://supabase.com/docs/guides/auth/sessions) and [signout scopes](https://supabase.com/docs/guides/auth/signout).

### 2.2 Comparison

| Dimension | 1. Short-lived JWT verification | 2. JWT + live Supabase session check | 3. Application-managed sessions |
|---|---|---|---|
| Credential and validation | Verify signature, allowed algorithm, issuer, audience, expiry and subject; refresh separately. | Same JWT checks plus authoritative validation of the matching provider session/user and policy. | Browser holds opaque random token; server looks up its digest, status, expiry and user. Provider authenticates initial identity. |
| Stolen credential | Replay possible until expiry; refresh theft can extend exposure. | Replay until provider session is revoked, provided every access path checks it. | Replay until app session is revoked; server can invalidate one/all sessions. Token theft still requires prevention. |
| Immediate logout | **Does not satisfy** the proposed contract by itself. A proposed five-minute token still leaves its remaining lifetime plus accepted clock skew. | Conditional on a supported, tested authoritative check and consistency. Local `/user` evidence alone is insufficient. | Can satisfy contract if revocation is durable and every request reads authoritative state. Not automatic merely because sessions are stored in a database. |
| Membership revocation | Requires live domain authorization; token expiry is irrelevant to current membership. | Same; provider session validity does not establish project/trip access. | Same; session record must not freeze roles at login. |
| Performance | Local crypto/JWKS cache; no per-request Auth round trip. Domain reads still needed. | Adds provider round trip and dependency, unless an explicitly supported authoritative integration avoids it. | Adds indexed session read, potentially combined with domain authorization. Depends on database location and consistency. |
| Complexity | Lowest verifier complexity; refresh, key rotation and browser security still required. | Provider-specific check, outage handling, logout scopes and rate-limit behavior require integration work. | Highest ownership: lifecycle, rotation, CSRF, expiry, revocation, abuse controls and identity bootstrap. |
| Availability | Works through temporary Auth outage while keys/tokens remain valid. | Private reads fail closed if authoritative session validation is unavailable. | Private reads fail closed if authoritative app session state is unavailable. Upstream login outage need not invalidate existing app sessions. |
| Expected cost drivers | Crypto CPU, refresh traffic, membership reads. | Same plus Auth requests/network capacity and provider plan. | Session reads/writes, storage and operational/security maintenance; upstream identity cost remains. |

**Requires validation:** [getUser](https://supabase.com/docs/reference/javascript/auth-getuser) performs a network request, but that fact is not a documented promise that every hosted logout mode immediately rejects every old token. Establish a supported session-validation mechanism and hosted behavior before adopting option 2. If a controlled server-side accessor to `auth.sessions` is needed, review least privilege and session policy explicitly; never expose the Auth schema or service credentials to the browser. Client `getSession()` is not an authoritative revocation check.

### 2.3 Recommended approach for review

**Recommendation:** prefer option 3, a same-origin Worker/API session boundary with application-managed opaque sessions, for the strict private-media/logout contract. Keep the identity provider interchangeable; this does **not** choose D1, PostgreSQL, Supabase or a production architecture. If Supabase is later selected, option 2 remains a viable lower-ownership alternative only after its hosted revocation contract is verified. Do not adopt option 1 as the sole gate for private resources under this contract.

Proposed controls, not implemented:

1. Use an audited OAuth/OIDC/session library and a fresh Google login transaction with state, nonce and PKCE as applicable. Do not allow a previously issued provider JWT to mint new app sessions indefinitely after app logout. Define reauthentication and provider-revocation synchronization; app and provider sessions are separate authorities.
2. Generate at least 32 cryptographically random token bytes, store only the token digest, and use a `__Host-` cookie with `Secure`, `HttpOnly`, `Path=/`, no `Domain` and an appropriate `SameSite` policy. Validate Origin/CSRF tokens for state-changing requests. Avoid persistent browser storage for bearer/refresh credentials. Follow [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
3. Rotate sessions on login and security-sensitive changes. Proposed review defaults: 30-minute idle timeout and seven-day absolute lifetime; these are **not approved product requirements**. Define single-device versus all-device logout explicitly. Avoid writing last-seen state on every image read without evaluating write cost and timeout accuracy.
4. Revoke app state durably before acknowledging logout; clear browser state and revoke upstream refresh capability where applicable. Provider outage must not prevent local app revocation. Require fresh authentication rather than silently recreating a revoked session.
5. Read session and membership state through an authoritative consistency path. No positive authorization cache or eventually consistent replica may extend the promised revocation window. A D1/PostgreSQL choice must demonstrate its actual cross-instance behavior. Return a transient failure on state-service outage; never fall back to offline allow. Separate invalid-session responses from operational failure without leaking object existence.
6. Route all private media/data through the same enforcement boundary. Direct PostgREST, Storage or R2 access must not bypass it. Local RLS passed independently, but service-role bypass was also verified; an app-session design does not automatically make direct provider JWT access safe. Decide restricted database privileges and any RLS principal propagation separately.
7. Serve private media through an authorized proxy initially. Presigned URLs are bearer capabilities and remain usable for their lifetime after membership/session revocation; already downloaded content also persists. If adopted later, document that bounded exception rather than promise immediate revocation. See [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

### 2.4 Performance and cost assumptions

**Cost assumption:** five users × two explorations/day × 60 private requests/exploration × 30 days = **18,000 private requests/month**, including image requests. All strategies need current membership checks. Option 2 could add 18,000 Auth checks; option 3 could add 18,000 session reads, possibly joined with authorization. Neither count is a measured workload or billable-unit equivalence. Login, refresh, uploads and retries are additional.

**Verified — documentation:** Supabase Free includes 50,000 monthly active users; Pro starts at USD 25/month, above the product's entire USD 0–10 target. These plan figures do not establish per-request latency, unlimited service capacity or an incremental price for each live check. See [Supabase pricing](https://supabase.com/pricing). D1/PostgreSQL query, connection, CPU and regional costs remain unmeasured for these strategies. Existing localhost API timings are not comparative authentication benchmarks.

**Recommendation:** before approval, test only the new gaps: cross-instance logout/membership races, refreshed-token and login-bootstrap replay, single/all-session scope, authoritative-store outage, stale-cache prevention, private image access after revocation and p50/p95 added latency. Use identical synthetic actors and requests. Report the exact acknowledgement/read ordering; do not rerun the completed 22-case suites merely to populate this proposal. Hosted Google OAuth and provider-session guarantees remain separately blocked by future account/resource authorization.

## 3. Proposal B — Narrow cloud media sandbox

### 3.1 Purpose and approval gate

**Recommendation:** isolate the shared media risk from both database candidates: one sandbox Worker, one private **R2 Standard** bucket and the Images binding. No hosted D1/PostgreSQL/Supabase project, production frontend integration or Google account is needed. This experiment informs both candidates equally and does not choose either.

**Blocked pending future authorization:** no cloud execution is authorized now. R2's [setup documentation](https://developers.cloudflare.com/r2/get-started/) requires an R2 subscription through checkout. Included free usage does not mean billing activation is unnecessary. Before any later execution, obtain explicit permission for the exact sandbox resources and inspect account eligibility/remaining allowances. If checkout, payment details, a paid plan or billing activation is needed, stop and request separate authorization; do not enable it under a free-tier assumption.

Cloudflare documents a 20 MB Images binding input limit and HEIC among supported formats. This is not proof that every HEIF container/profile is accepted. The binding path must be tested, rather than substituting a different URL-transformation limit. See [Images limits](https://developers.cloudflare.com/images/get-started/limits/).

### 3.2 Synthetic fixtures and bounded scope

Reuse the actor IDs and scope expectations from [shared fixtures](../spikes/shared/fixtures.json) and [scenarios](../spikes/shared/scenarios.json). A closed sandbox harness may use short-lived synthetic signed grants and an authoritative mutable grant manifest for revocation tests. Label this **mock authentication**, not Supabase/Google verification. Never deploy the existing unauthenticated local `/harness/*` controls.

Prepare and review a fixed manifest before deployment, with **at most 24 source files**:

- Programmatically generated photographic patterns: genuine HEIC SDR and supported-to-generate HDR/10-bit profiles; genuine HEIF fixtures with recorded codec/container brands; rotated/oriented images; JPEG, PNG and WebP controls. Renaming HEIC to `.heif` does not prove distinct compatibility. Record unavailable encoders/profiles as blocked.
- Synthetic EXIF GPS `(0,0)`, dates, camera serial, owner and XMP/IPTC sentinel strings; no personal data. Retain the existing 723-byte HEIC only as a regression fixture, not representative camera evidence.
- Independently decodable, representative-dimension images at **19,900,000**, **20,000,000**, and **20,000,001 bytes**. Prefer encoded image payload; record any minimal legal padding and decoded pixel dimensions. Do not reuse tiny-image/large-padding results as realistic memory evidence. If exact-size valid fixtures cannot be generated, report that blocker.
- Where capacity allows, 20,971,520 and 20,971,521-byte diagnostics distinguish decimal MB from MiB. Decimal 20,000,000 is a proposed admission interpretation pending review, not an amendment to the PRD. Include a small malformed/truncated and disguised-content set.

Manifest evidence: fixture ID, generator/version/seed, bytes, SHA-256, MIME signature, container/codec/bit depth, dimensions, orientation and expected metadata. Validate fixtures with an independent decoder/parser before interpreting provider rejection. Synthetic encoding cannot establish all real iPhone/Android compatibility; that remains explicitly unverified.

### 3.3 Experiment sequence and acceptance evidence

| Step | Planned test | Required result/evidence |
|---|---|---|
| M0 — preflight | Confirm explicit resource approval, free-plan eligibility, account allowance baseline, supported binding and least-privilege access. | Sanitized configuration/version record; no secrets. Any required billing activation blocks execution. |
| M1 — private objects | Upload known synthetic bytes; test anonymous GET/HEAD/range, invalid identity, wrong trip and authorized derivative/original permissions. | Originals retain source hashes; direct public reads denied. Project/trip access and stricter original permissions match fixtures. Revoked grants deny subsequent reads. |
| M2 — compatibility | Feed actual HEIC/HEIF and controls through private R2 streams into Images; explicitly request fixed WebP thumbnail/display outputs. | Per-profile success/error, output signature, decodability, dimensions, orientation and independently inspected contact sheet. No silent original fallback or extension renaming. |
| M3 — metadata | Inspect every derived output independently of the transformer using a RIFF parser and a metadata extractor. | No EXIF/XMP/IPTC/GPS or synthetic identifying sentinels; document any color-profile allowlist. Original stays unchanged/private. Verify orientation survives metadata removal. |
| M4 — size boundaries | Transfer complete exact-size files, not just Content-Length claims. Test private R2 input and selected direct-stream binding cases. | Bytes read, status/provider code, output and timing for 19.9 MB, 20 MB and above-limit files. Valid in-limit required formats must succeed or remain a blocker. |
| M5 — admission versus provider | Separately test proposed application size/content admission and a tightly restricted raw binding diagnostic. | App rejects above its reviewed byte limit before persisting/processing; raw probe records actual provider boundary independently. Do not infer provider rejects 20,000,001 bytes merely because the PRD says 20 MB. |
| M6 — failures/access | Malformed files, conversion failure, interrupted upload and revoked grant before fetch. | No partial published derivative, public object, original fallback or unrestricted source URL. Record leftovers and scoped cleanup. No quota/idempotency acceptance claim beyond this media experiment. |
| M7 — metering/cleanup | Correlate run ledger with provider usage before/after and delayed billing data; remove only sandbox resources. | Actual operations, storage-duration, transformations, CPU/wall time, request volume and attributable charge, or explicit pending/unattributable status. Verify deletion and revoke sandbox credentials. |

**Verified — documentation, not cloud execution:** Cloudflare states non-JPEG outputs such as WebP discard metadata. Independent M3 verification remains necessary; WebP as a format can carry metadata, and MIME/filename alone proves nothing. See [Images features](https://developers.cloudflare.com/images/optimization/features/).

Security configuration for the future sandbox: disable public R2 access and public custom-domain delivery; use authenticated Worker reads with `Cache-Control: private, no-store` and no shared cache. Authorize before transforms or object access, accept only allowlisted fixture identifiers, and do not fetch arbitrary submitted URLs. Keep R2 access credentials server-side and bucket-scoped. Log fixture/run IDs and error codes, never tokens, cookies, signed URLs or credential files. Use only HTTPS. A revocation test must exercise fresh network access rather than a browser's previously downloaded bytes.

### 3.4 Resource limits and cost model

**Recommendation — proposed hard experiment bounds:** maximum 72 hours, 1 GB stored, 24 originals, two variants per source, 100 transformation attempts total including failures/retries, 500 Worker HTTP calls, 250 R2 Class A and 1,000 Class B operations. Begin sequentially; permit at most two concurrent transformations after basic probes pass. Allocate at most 48 R2-based variant attempts, 20 critical direct-stream attempts and 32 failures/retries/diagnostics. Review the manifest/ledger to fit all limits before execution. These are harness stop conditions, not provider-enforced monetary caps.

| Verified — documentation, USD rates checked 2026-11-01 | Cost interpretation |
|---|---|
| [Images pricing](https://developers.cloudflare.com/images/pricing/): Free includes 5,000 unique transformations/month for external images; new transformations beyond allowance fail rather than generate Free-plan overage. Paid transformation rate is $0.50/1,000 beyond included allowance. | Use external/private R2 inputs, not paid Images hosting. Unique transformations and attempts differ; measure actual billing behavior. Do not upgrade to make a failing test pass. |
| [R2 pricing](https://developers.cloudflare.com/r2/pricing/): Standard includes 10 GB-month, 1 million Class A and 10 million Class B monthly; listed overage rates $0.015/GB-month, $4.50/million A, $0.36/million B; direct egress is free. Usage rounds to billing units. | Allowances may already be consumed by other account activity. Do not multiply tiny request counts by a fractional unit price and call that a bill. Avoid Infrequent Access. |
| [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/): Free has 100,000 requests/day and 10 ms CPU per invocation; Paid starts at $5/month. | Payload processing/auth overhead must fit the actual plan. CPU-limit failure is a finding, not permission to upgrade. |

**Cost assumption:** incremental provider charges could be $0 if already-authorized services and remaining Free allowances cover the run. This is not a guarantee or evidence of actual spend. A full 1 GB retained for three days is approximately 0.1 GB-month before provider metering/rounding; transformations, request classification and account-wide usage still need reconciliation. Taxes, account subscriptions and unrelated activity are outside that estimate.

Record pre-run account counters, per-operation application ledger, provider analytics after the run and final billing once available. Report observed usage separately from estimated marginal cost and posted charges. If account sharing or billing delay prevents attribution, mark cost **Requires validation**, with the observation window. Budget alerts may be delayed and are not hard caps. Stop before any paid upgrade or unapproved billing action; do not claim application counters eliminate financial risk.

### 3.5 Stop conditions and remaining uncertainty

Stop on unauthorized exposure, unexpected real data, credential leakage, exhausted experiment bounds, unexpected billing requirement or unsupported required format/size. Preserve sanitized failures; do not weaken privacy, silently remove HEIF or lower the product limit. Clean up only identified sandbox objects, incomplete multipart uploads, Worker and bucket after evidence collection; verify empty/deleted state. No account-wide cleanup.

Successful sandbox evidence requires all mandatory M1–M6 privacy/format/size checks to pass, with M7 metering reconciled or explicitly pending. Classify each case **PASS / FAIL / BLOCKED / UNTESTED** and retain commands, sanitized configuration, fixture/output hashes, independent parser reports, request IDs, exact errors and timings. No cloud claim is valid before execution.

Remaining outside this narrow plan: real Google OAuth and browser session integration; hosted Supabase revocation semantics; real-device photo coverage; remote D1/PostgreSQL transaction behavior; managed backups; production network/mobile performance; complete upload lifecycle/quota integration. The completed local tests need not be repeated to acknowledge these gaps.

## 4. Decisions requested at architecture review

1. Accept or revise the session revocation contract and provisional opaque-session preference, including logout scopes, expiry policy and the prohibition on bypass access paths.
2. Review the exact HEIF profile coverage, decimal/MiB interpretation, sandbox fixture manifest and bounded test budget without changing approved product requirements implicitly.
3. Separately authorize any future cloud execution and resolve subscription/billing prerequisites. This document grants none of those permissions.

**Recommended next technical decision:** settle the session authority/revocation boundary first, then approve or reject the bounded shared-media sandbox. Keep the production architecture open until the remaining evidence is available.
