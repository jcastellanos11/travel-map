# Collaboration — E2.3

`routes.ts` maps the nine approved management endpoints to explicit
`collaboration.*` actions. `validation.ts` bounds JSON and rejects privileged fields;
settings are partial and never inject defaults. The existing app composition checks
session format, exact Origin and CSRF before dispatch. No provider/cookie changes.

SQL `collaboration_action` in 0005 receives actor identity only from authenticated
api_call. Every mutation takes an exclusive Project lock before role checks; Trip
and grant locks follow deterministic order. Roster uses a shared Project lock and
bounded pagination. SQL repeats input/ancestry checks for direct RPC callers.

Project departure revokes all descendant explicit grants, including inactive Trips.
Guest departure is separate and cannot suppress inheritance. Content and creator
IDs remain unchanged. Audit insertion shares the domain transaction; failures undo
all mutations. Audit has no runtime read/write surface and no sensitive payloads.

All mutations except settings return 204; settings returns the existing Project DTO.
Roster returns IDs/display names/roles/creation timestamps, no emails. See the API
contract for safe errors. There is no membership issuance or restore implementation.
