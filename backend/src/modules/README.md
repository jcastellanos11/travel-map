# Module boundaries

One Worker composes modules through `src/app.ts`. Business modules must not
import HTTP handlers from other modules or read their tables ad hoc. Introduce
explicit services/ports as functionality is implemented; no distributed services.

| Module | Ownership | Stage |
|---|---|---|
| `system/` | Liveness; later operational readiness | E0 |
| `identity/` | Stable provider mapping, account state, opaque application sessions | E0 types/deny boundary; actual login/session service E1 |
| `projects/` | Projects, single owner, project memberships | E0 types/schema; service/authorization E1 |
| trips | Project-scoped trips and trip-only memberships | E2 |
| visits/places | Repeated visits, date-only ranges, shared geographic identity | E2 |
| photos/uploads | Private original/derivative lifecycle, operation idempotency | E4 |
| quota | Atomic reservation/accounting, separate author/responsible user | E4 |
| invitations | Hashed one-use grants and redemption | E5 |
| retention | Trash, assisted deletion/transfer, safe purge | E4/E5 |
| observability | Redacted security/operational events | Incremental; no sensitive logging in E0 |

Only the three E0 modules have code today. Later modules are not empty service
stubs or implemented endpoints. `shared/` contains HTTP mechanics, not business
authorization. Node-only migration tools live in `scripts/`, outside the Worker
import graph. No application dependency on `spikes/` is permitted.

E1 must replace the deny boundary with real, authoritative application-session
validation and a central domain authorization service. Valid provider JWTs alone,
caller roles, ownership history and UI capabilities never authorize a request.
RLS is defense in depth; database invariants do not implement actor authorization.
