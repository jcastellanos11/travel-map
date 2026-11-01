# Modular monolith boundaries

One Worker composes modules through `src/app.ts`; there are no microservices.

| Module | Ownership | Current scope |
|---|---|---|
| `system/` | Public liveness | E0 implemented |
| `identity/` | Verified provider identity, OAuth transaction, opaque session, CSRF | E1 local implementation; real Google acceptance pending |
| `projects/` | Project model, input/pagination validation | E1 services enforced through scoped SQL RPC |
| `infrastructure/postgres.ts` | Parameterized, bounded server-only SQL transport | E1 restricted database role; never a browser connection |
| trips, visits/places | Project/trip scopes, repeated visits, geographic identity | E2, not started |
| photos/uploads, quota | Private media lifecycle and atomic accounting | E4, not started |
| invitations, retention | Collaboration and assisted lifecycle procedures | E5/later approved scope, not started |

SQL functions form the central authorization boundary for E1: validate current
session/account, resolve current owner/membership and filter before projecting or
counting. Only the trusted server role can invoke bootstrap functions; browser
roles have no schema/table/function privileges. E1's schema migration owner is the
SECURITY DEFINER authority and must never be a runtime/browser credential.

No imports from `spikes/`, test provider fixtures or test identity seeds are allowed
in the production entry graph. Test injection ports are ordinary in-process
interfaces, not HTTP backdoors or deployable mock authentication modes. Node-only
migration/admin tools remain in `scripts/`, outside the Worker bundle.
