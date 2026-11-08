# Modular monolith boundaries

One Worker composes modules through `src/app.ts`; there are no microservices.

| Module | Ownership | Current scope |
|---|---|---|
| `system/` | Public liveness | E0 implemented |
| `identity/` | Verified provider identity, OAuth transaction, opaque session, CSRF | E1 implemented; real Google/logout accepted in prior user session |
| `projects/` | Project model, input/pagination validation | E1 services enforced through scoped SQL RPC |
| `infrastructure/postgres.ts` | Parameterized, bounded server-only SQL transport | E1 restricted database role; never a browser connection |
| `trips/` | Trip DTOs, request validation and routing | E2.1 implemented; inherited authorization enforced in SQL |
| `geography/` | Controlled Places, Visit DTO/validation/routes, scoped map projections | E2.2 implemented; private SQL handlers; exact Visit points disabled |
| `collaboration/` | Membership roster/actions, Project settings and archival | E2.3 implemented; exclusive Project locks and transactional audit in private SQL |
| `media/` | Private media domain types and SQL lifecycle/accounting contracts | E4.1 foundations only; no HTTP, storage or processing |
| invitations, retention | Collaboration and assisted lifecycle procedures | E2.4/later approved scope, not started |

SQL functions form the central authorization boundary for E1/E2.1/E2.2/E2.3: validate current
session/account, resolve current owner/membership and filter before projecting or
counting. Only the trusted server role can invoke bootstrap functions; browser
roles have no schema/table/function privileges. E1's schema migration owner is the
SECURITY DEFINER authority and must never be a runtime/browser credential.

No imports from `spikes/`, test provider fixtures or test identity seeds are allowed
in the production entry graph. Test injection ports are ordinary in-process
interfaces, not HTTP backdoors or deployable mock authentication modes. Node-only
migration/admin tools remain in `scripts/`, outside the Worker bundle.

`geography/` reuses E2.1 trip ancestry/permission locks through private trips_action;
creator edit rights apply only to Visits with current access. Catalog is independent
of user content, attributed in catalog/README.md, and no inline resolver or public
place mutation exists. Map DTOs contain only authorized Visits; photos=0/null.
Country/Place/Visit tables have owner-only FORCE RLS and no runtime table grants.
Only authenticated api_call dispatches to private geography_action; new helper
functions are never runtime-executable. No EXIF, GPS sharing, members/invitations,
delete/restore, storage or frontend integration belongs to this increment.

E2.4 `invitations/` now implements restricted issuance/list/revoke/redeem plus a
minimal server invitation continuation page. Its private SQL helpers extend api_call
without widening the runtime RPC surface. Media, retention, transfers and frontend
application integration remain outside this increment.
