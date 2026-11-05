# Travel Map — Contrato HTTP v0.1 (MVP)

**Estado:** BORRADOR DE IMPLEMENTACIÓN — 2026-11-01  
**Dependencias:** `docs/PRD.md`, `docs/DATA_MODEL.md`, `docs/AUTHORIZATION_MATRIX.md`, `docs/ADR-001-STACK.md`.  
**Objetivo:** integrar React + Leaflet con una API REST protegida, sin mezclar datos de viajes, autenticación, archivos ni permisos. Los nombres y formatos aquí especificados son una **primera propuesta técnica**; cambios de forma son admisibles antes de consumirla desde frontend, conservando los requisitos de producto.

**Actualización E2.3 (2026-11-05):** las secciones implementadas al final de este documento prevalecen sobre DTOs orientativos anteriores. Invitaciones, restauración y medios siguen sin implementar.

## 1. Convenciones transversales

- Base: `/api/v1`; JSON UTF-8; fechas de visita son cadenas de calendario `YYYY-MM-DD` y **no timestamps UTC**. Tiempos operativos sí son ISO 8601 UTC.
- IDs estables, opacos, generados por servidor. No confiar en `ownerId`, `role`, `quotaOwnerId`, tamaños finales de objetos o estados enviados por el navegador.
- Todas las rutas privadas exigen sesión actual válida y comprobación de acceso a recurso en servidor. Cookie HttpOnly `__Host-` y protección CSRF/Origin en métodos mutables. Credenciales nunca en logs.
- Respuestas de listas paginadas mediante `cursor` opaco y `limit` (por defecto 25, máximo propuesto 100). Un filtro o un conteo solo ve recursos autorizados. Orden estable por `(createdAt, id)` donde aplique.
- El navegador puede enviar `Idempotency-Key` para operaciones de escritura relevantes; para cargas se exige identificador de operación y archivo. La semántica persistente se define en cuota/uploads.
- Para recursos privados ajenos/desconocidos, preferir respuesta uniforme `404` sin pistas de existencia. `401` si falta sesión; `403` solo si la acción sobre un recurso visible está expresamente prohibida. Nunca inferir permisos por rutas expuestas.
- Estados HTTP propuestos: `200`/`201` éxito; `202` procesamiento; `204` resultado sin cuerpo; `400` validación; `401` sesión ausente; `403` acción denegada; `404` no visible; `409` conflicto/idempotencia/estado; `413` tamaño excesivo; `415` formato real rechazado; `422` fechas/tipo de dato inválidos; `429` límite de ritmo/cuota operacional; `503` dependencia temporalmente indisponible. La cuota de almacenamiento puede devolver `409` con código `QUOTA_EXCEEDED`.

**Error único (propuesto):**

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Resource not available",
    "requestId": "req_opaque"
  }
}
```

No incluir rutas privadas, tokens, EXIF, emails ajenos ni detalles de existencia en mensajes.

## 2. Sesión e identidad

| Método | Endpoint | Resultado previsto |
|---|---|---|
| `GET` | `/api/v1/auth/google/start` | Inicia flujo Google a través de Supabase Auth, con transacción OAuth protegida. Puede responder redirección. |
| `GET` | `/api/v1/auth/callback` | Valida resultado de login; crea sesión opaca del Worker y redirige al frontend. Nunca exponer secretos en URL final. |
| `GET` | `/api/v1/me` | Perfil mínimo de la cuenta autenticada, sin datos de otros usuarios. |
| `POST` | `/api/v1/auth/logout` | Invalida sesión actual antes de confirmar respuesta. |
| `POST` | `/api/v1/auth/logout-all` | Invalida todas las sesiones de la cuenta, si se incluye interfaz/acción. |

**Nota:** las rutas exactas de OAuth pueden ajustarse a la biblioteca segura elegida. El objetivo no es construir un protocolo OAuth manual ni permitir que tokens antiguos recreen sesiones revocadas. Las solicitudes posteriores a logout deben fallar también para imágenes privadas. Futura auditoría debe verificar interacción de cookies, CORS/same-origin y nombre real de dominio.

**`GET /me` respuesta orientativa:**

```json
{
  "id": "usr_123",
  "displayName": "Demo User",
  "email": "user@example.invalid",
  "storage": { "usedBytes": 1000000, "reservedBytes": 0, "quotaBytes": 500000000 }
}
```

## 3. Proyectos, miembros e invitaciones

| Método | Endpoint | Permiso/resultado |
|---|---|---|
| `GET` | `/api/v1/projects` | Proyectos con acceso efectivo; lista paginada. |
| `POST` | `/api/v1/projects` | Crear proyecto propio; política de creación de viajes por defecto explícita. |
| `GET` | `/api/v1/projects/{projectId}` | O/A/M con acceso. G de viaje no adquiere acceso a la vista completa. |
| `PATCH` | `/api/v1/projects/{projectId}` | Solo ajustes no sensibles con política aprobada; **O/A** según P-02b Option A aprobada: nombre y política existente de creación de viajes. |
| `GET` | `/api/v1/projects/{projectId}/members` | Administración de colaboración autorizada; proyección mínima de participantes. |
| `POST` | `/api/v1/projects/{projectId}/invitations` | O/A; destino `project` o `trip`; token secreto devuelto solo al emisor. |
| `GET` | `/api/v1/projects/{projectId}/invitations` | O/A; listar estados, nunca hashes ni tokens completos. |
| `POST` | `/api/v1/invitations/redeem` | Usuario autenticado; canje de un solo uso atómico, expiración inicial 7 días. |
| `POST` | `/api/v1/projects/{projectId}/members/{userId}/promote-admin` | Solo O, operación sensible. |
| `POST` | `/api/v1/projects/{projectId}/members/{userId}/remove-admin` | Solo O, nunca remover propietario accidentalmente. |
| `POST` | `/api/v1/projects/{projectId}/archive` | Solo O (#38); no libera cuota. |

**Operaciones administrativas complejas** (transferencia de propietario, eliminar cuenta, eliminar proyecto con terceros) pueden iniciar solicitudes asistidas conforme al PRD, antes de ofrecer endpoints irreversibles. No exponer purga física directa desde el navegador.

**Crear proyecto:**

```json
{
  "name": "Mis viajes",
  "tripCreationPolicy": "admins_only"
}
```

`tripCreationPolicy` admite `admins_only` o `all_project_members`. Política inicial propuesta `admins_only`, no una decisión adicional de producto.

**Crear invitación:**

```json
{
  "target": { "kind": "trip", "id": "trip_123" }
}
```

Un token de invitación no concede acceso hasta que una cuenta autenticada lo canjee. Los secretos se guardan como hash; no regresar el token en consultas posteriores.

## 4. Viajes y vistas de mapa

| Método | Endpoint | Reglas |
|---|---|---|
| `GET` | `/api/v1/projects/{projectId}/trips` | O/A/M; listas y conteos autorizados. G no accede a la lista general del proyecto. |
| `POST` | `/api/v1/projects/{projectId}/trips` | O/A o M si política permite; G nunca. |
| `GET` | `/api/v1/trips/{tripId}` | O/A/M del proyecto o G de ese viaje; exponer mínimo contexto del proyecto al G. |
| `PATCH` | `/api/v1/trips/{tripId}` | Solo O/A; P-03 opción A aprobada (2026-11-04). M creador tampoco edita. |
| `POST` | `/api/v1/trips/{tripId}/archive` | Por defecto O/A, sujeto a matriz pendiente. |
| `GET` | `/api/v1/projects/{projectId}/map` | Mapa general solo O/A/M; filtros autorizados. |
| `GET` | `/api/v1/trips/{tripId}/map` | Mapa del viaje; incluye G del viaje autorizado. |

Filtros propuestos para mapas: `countryCode` (ISO 3166-1 canonicalizado), `tripId` (solo en mapa de proyecto), `from` y `to` (`YYYY-MM-DD`). Los filtros temporales devuelven visitas con rango **solapado**; visitas sin fecha están en la vista general, pero no al activar filtro temporal.

**Ejemplo histórico propuesto para medios futuros (E2.2 devuelve photoCount=0 y previewPhotoId=null; véase contrato implementado al final):**

```json
{
  "items": [
    {
      "visitId": "vis_123",
      "tripId": "trip_123",
      "place": {
        "id": "place_bogota_col",
        "countryCode": "COL",
        "countryName": "Colombia",
        "city": "Bogotá",
        "approximateCoordinates": { "lat": 4.7, "lng": -74.1 }
      },
      "confirmedCoordinates": null,
      "date": { "mode": "none", "start": null, "end": null },
      "photoCount": 2,
      "previewPhotoId": "photo_123"
    }
  ],
  "nextCursor": null
}
```

**Privacidad:** `confirmedCoordinates` solo si el autor de la visita las confirmó y su visibilidad está autorizada. Nunca devolver GPS bruto EXIF ni incluir visitas ajenas para calcular facetas/total.

## 5. Places y Visits

| Método | Endpoint | Reglas |
|---|---|---|
| `GET` | `/api/v1/places?countryCode=COL&query=Bog` | Catálogo geográfico desacoplado; sin recuerdos privados. La implementación inicial puede ser un catálogo limitado/controlado. |
| `GET` | `/api/v1/trips/{tripId}/visits` | Visitas dentro de viaje visible. |
| `POST` | `/api/v1/trips/{tripId}/visits` | Cualquier colaborador autorizado (incluido G del viaje). |
| `GET` | `/api/v1/visits/{visitId}` | Acceso por viaje y estados. |
| `PATCH` | `/api/v1/visits/{visitId}` | Creador con acceso u O/A. |
| `DELETE` | `/api/v1/visits/{visitId}` | Papelera lógica; creador u O/A; salvaguardas por fotos de terceros. |

**Ejemplo histórico de propuesta inline; NO aceptado por E2.2 (usar placeId según contrato implementado al final):**

```json
{
  "place": { "countryCode": "COL", "city": "Bogotá", "region": "Bogotá D.C." },
  "name": "Centro histórico",
  "confirmedCoordinates": null,
  "date": { "mode": "range", "start": "2026-08-10", "end": "2026-08-12" }
}
```

- `place` se normaliza a una identidad `Place` compartida sin fusionar visitas. La decisión sobre proveedor/catálogo de localidades aún no está tomada.
- `date.mode`: `none` (`start/end=null`), `single` (un día calendario), `range` (inicio y fin inclusivos, inicio <= fin). No realizar conversiones UTC de días de calendario.
- Pueden existir visitas vacías y visitas repetidas a la misma ciudad.
- `DELETE Visit`: mantener recursos protegidos y un procedimiento de restauración/retención; plazo de Visit propuesto 30 días está pendiente en matriz P-04. No implementar purga irrevocable antes de aprobación.

## 6. Fotografías y cargas — contrato propuesto

| Método | Endpoint | Regla |
|---|---|---|
| `GET` | `/api/v1/visits/{visitId}/photos` | Foto disponible y visible por permisos, lista paginada. |
| `POST` | `/api/v1/visits/{visitId}/upload-operations` | Crea lote de 1–10 slots; reserva cuota por archivo/operación. |
| `PUT` | `/api/v1/upload-operations/{operationId}/files/{fileId}/content` | Envía bytes (stream) a almacenamiento privado tras autorización y validación del slot. |
| `POST` | `/api/v1/upload-operations/{operationId}/files/{fileId}/finalize` | Confirma original y derivados; carga parcial; devuelve procesando/disponible/fallido. |
| `GET` | `/api/v1/upload-operations/{operationId}` | Estado por archivo y motivos de fallo autorizados. |
| `POST` | `/api/v1/upload-operations/{operationId}/files/{fileId}/retry` | Reintenta ese archivo con misma identidad de operación; no dobla cuota. |
| `GET` | `/api/v1/photos/{photoId}` | Metadatos mínimos, sin EXIF sensible bruto. |
| `PATCH` | `/api/v1/photos/{photoId}` | Descripción del autor u O/A con acceso. |
| `GET` | `/api/v1/photos/{photoId}/media/{variant}` | `thumbnail`/`display`; pasar por Worker autorizador y no cache compartida. |
| `GET` | `/api/v1/photos/{photoId}/original` | Solo autor actual con acceso o O/A; descarga privada y aviso EXIF. |
| `DELETE` | `/api/v1/photos/{photoId}` | Enviar a papelera 30 días, no liberar cuota. |
| `POST` | `/api/v1/photos/{photoId}/restore` | Restaurar dentro de plazo con estados y permisos válidos. |

**Inicio de operación:**

```json
{
  "files": [
    { "clientFileId": "file-1", "name": "photo.heic", "declaredBytes": 10500000, "declaredMime": "image/heic" }
  ]
}
```

**Respuesta propuesta:**

```json
{
  "operationId": "up_opaque",
  "files": [
    { "clientFileId": "file-1", "fileId": "uf_opaque", "status": "reserved" }
  ]
}
```

**Seguridad y consistencia de cargas:**

1. `Idempotency-Key` generado para la operación y clave inmutable por archivo. Una nueva operación con el mismo binario es una carga intencional independiente.
2. Contar original y variantes almacenadas por su tamaño real; manejar reservas atómicas en PostgreSQL. Reintentos y fallas no pueden cobrar dos veces ni publicar fotos sin activos requeridos.
3. No confiar en extensión, MIME declarado, Content-Length ni byte size que envíe React. Validar bytes, formato real y límites en backend/procesador. Límite de 20 MB y máximo de 10 por operación, con resultados individuales. Definición decimal frente a MiB pendiente de cerrar en el validador.
4. Procesar EXIF como **sugerencia que requiere confirmación**. No editar automáticamente `Place`/`Visit` ni exponer GPS. Almacenar originales privados; derivados sin metadatos identificativos.
5. Las imágenes no deben salir por `public/images`, URL abierta, un bucket R2 público ni enlace firmado de larga vida. Cerrar sesión o retirar membresía deniega próximas solicitudes privadas.
6. Si R2 aún no está habilitado, implementar adaptador de almacenamiento **local solo para desarrollo**, con misma interfaz y controles de seguridad. No devolver rutas `file://` ni rutas del sistema a cliente.
7. La responsabilidad de almacenamiento y autoría son columnas diferentes. Las transferencias/retiradas tras salida son procesos asistidos si hace falta.
8. No implementar procesamiento de larga duración como tarea HTTP frágil sin política de recuperación; definir adaptador/cola compatible con hosting disponible y registrar estado de procesamiento.

## 7. Cambios de estado y procesos asistidos

- `POST /api/v1/projects/{id}/archive` O únicamente; viajes podrían archivarse por O/A sujetos a confirmación P-03.
- Eliminación de fotos/trips/projects no destruye automáticamente aportes de otros. Las solicitudes con terceros se marcan y se someten a procedimiento administrativo documentado.
- Casos de retirada tras salida, transferencia de cuota y borrado de cuenta: la beta puede usar un canal/procedimiento autenticado y auditado. **No** se debe crear un `DELETE` irreversible que ignore estas reglas.
- Para fotografías en papelera, 30 días de restauración y consumo de cuota hasta purga efectiva; backup/purge policy aparte.

## 8. Consulta geográfica entre viajes — NO MVP

El backend deberá modelar `Place.countryCode`, `Place.id` y `Visit.placeId` de manera indexable. Una futura consulta `GET /api/v2/photos?countryCode=COL` o por lugar **no forma parte del contrato MVP**, ni está autorizada para bypass de ACL. Cualquier búsqueda futura filtra scopes primero, deduplica `Photo.id` y no expone conteos ajenos.

## 9. Contratos de error y validación sugeridos

| Código `error.code` | Uso |
|---|---|
| `SESSION_REQUIRED` | Autenticación ausente/revocada. |
| `RESOURCE_NOT_FOUND` | Recurso no visible o inexistente. |
| `ACTION_FORBIDDEN` | Permiso insuficiente sobre recurso visible. |
| `VALIDATION_ERROR` | Cuerpo/fecha inválidos. |
| `INVALID_FILE_TYPE` | Binario no compatible. |
| `FILE_TOO_LARGE` | Límite de tamaño superado. |
| `QUOTA_EXCEEDED` | Cuota usada+reservada excedería máximo. |
| `UPLOAD_CONFLICT` | Operación/archivo reusado con datos incompatibles. |
| `INVITATION_INVALID` | Caducada, revocada, canjeada o no válida, sin fuga. |
| `DEPENDENCY_UNAVAILABLE` | Infraestructura de sesión/BD/medios indisponible. |

## 10. Criterios mínimos para comenzar implementación

- **Primer vertical slice:** autenticación Google (identidad estable, sesión revocable), crear/listar proyecto privado, sin endpoints de media ni despliegue.
- **Segundo:** viajes, visitas, Place y vistas de mapa con filtrado de permisos y 100 visitas simuladas para integración.
- **Tercero:** cargas con cuotas, R2 privado, variantes, controles de formato, EXIF y recuperación.
- **Cuarto:** invitaciones de proyecto/viaje, papeleras, salidas y proceso asistido de derechos y respaldo.
- Los defaults provisionales en la matriz de autorización se mantienen *fail closed*: nunca aumentar privilegios por una laguna del documento. Antes de implementar una acción sensible, aprobar o diferir explícitamente su política.
- No empezar con login simulado en producción ni subir secretos al repositorio. Las rutas `/harness/*` de PoC nunca se migran a la API.

## 11. Lo que aún NO decide este documento

- ORM/query builder, biblioteca OAuth/session/CSRF, SDK concreto de Supabase, migraciones y estructura exacta de módulos.
- Proveedor de catálogo de ciudades, variantes óptimas, procesador de respaldo para formatos HEIC/HEIF no admitidos.
- Estrategia exacta de procesamiento asíncrono y recuperación de trabajos.
- Reglas pendientes de producto P-01b, P-02b, P-03 a P-10 de `AUTHORIZATION_MATRIX.md`, y plazo propuesto para visitas; por defecto denegar acciones no aprobadas.
- Fecha o alcance de despliegue cloud: requiere autorización posterior para crear servicios, R2 y secretos.

**Siguiente artefacto:** `docs/IMPLEMENTATION_PLAN.md`.

## E2.1 implemented Trip contract (2026-11-04)

These four routes are implemented; other planned routes above remain future work.

| Method and route | Effective authorization | Success |
|---|---|---|
| GET `/api/v1/projects/{projectId}/trips` | Active project Owner/Admin/Member; no trip-only Guest enumeration | 200 `{items,nextCursor}` |
| POST `/api/v1/projects/{projectId}/trips` | Owner/Admin; Member only if `tripCreationPolicy=all_project_members` | 201 Trip |
| GET `/api/v1/trips/{tripId}` | Inherited active project access or explicit active Guest for this Trip | 200 Trip |
| PATCH `/api/v1/trips/{tripId}` | Owner/Admin only (P-03 Option A); Member authorship grants no edit permission | 200 Trip |

Trip DTO: `{id,projectId,createdByUserId,name,description,status,createdAt,updatedAt}`. UUIDs are strings; timestamps are UTC ISO-8601. `description` is string or null. Guest receives this same minimal Trip projection, without project roster, names, emails, aggregates or other Trips. IDs are references, never access credentials.

POST accepts only `{name,description?}`; PATCH accepts at least one of these fields. Name is trimmed, 1–200 Unicode code points without control characters. Description is optional, up to 2000 Unicode code points; null clears it, omission on PATCH preserves it. JSON body budget is 16,384 bytes. Invalid JSON, unknown fields, invalid Unicode, creator/project/role/status assignment and empty PATCH return 400. Path determines parent/Trip; session determines creator. No lifecycle/membership mutations are implemented.

List accepts only `limit` (default 25, maximum 100) and opaque `cursor`, using the existing Project pagination format. Order is ascending `(createdAt,id)`, scoped to active Trips of the authorized active parent before pagination. No totals; authorization is re-evaluated on every page. A cursor is a pagination hint, not permission or a snapshot guarantee.

All routes retain E1 opaque sessions. Mutations retain exact Origin and `X-CSRF-Token` verification. Missing/invalid/expired/revoked session: 401; forbidden action on visible resource: 403; hidden/foreign/unknown/inactive resource: 404; invalid input: 400; recognized operation conflict: 409; database unavailable: 503. No raw SQL detail is returned. Security checks can reject a malformed mutation before its resource lookup; no existence is disclosed.

SQL entry remains `api_call`; new handlers are private. See [E2.1 validation](../backend/E2_1_VALIDATION.md) for migration and test evidence. Visits, invitations, member administration, archival, media and frontend integration are not implemented here.

## E2.2 implemented geography contract (2026-11-04)

This section is the implemented contract for the routes below. Earlier inline-place examples, photo examples and DELETE routes are proposals for future stages, not supported E2.2 behavior.

| Method | Route | Authorization / success |
|---|---|---|
| GET | `/api/v1/places?countryCode=COL&query=Bog` | Active session; independent controlled catalog; 200 page |
| GET | `/api/v1/trips/{tripId}/visits` | Active inherited O/A/M or explicit G of this Trip; 200 page |
| POST | `/api/v1/trips/{tripId}/visits` | Same Trip collaborators, including G; 201 Visit |
| GET | `/api/v1/visits/{visitId}` | Current active Trip/Project ancestry access; 200 Visit |
| PATCH | `/api/v1/visits/{visitId}` | Creator with current access, or active Project O/A; 200 Visit |
| GET | `/api/v1/projects/{projectId}/map` | Active O/A/M only; G cannot enumerate Project; 200 map page |
| GET | `/api/v1/trips/{tripId}/map` | Authorized Trip readers including scoped G; 200 map page |

POST accepts `{placeId,name?,date?,confirmedCoordinates?}`. placeId is a required UUID selected from catalog candidates; unknown UUIDs return 400. No inline place text, guessed match, implicit global catalog entry or automatic resolver exists. name is null or trimmed nonempty string, max 200 Unicode code points without control characters; omission defaults null. No description field is implemented. date omission defaults to none. confirmedCoordinates may be omitted or null; every non-null value is rejected (including a point claiming confirmation). Body max 16,384 bytes, application/json only.

PATCH accepts any nonempty subset of the same fields; omission preserves existing values, null clears name, date replacement must be complete. placeId may change under Visit edit permission; tripId/projectId/creator/status/privileged assignments are always rejected. No DELETE/trash/restore or lifecycle mutation routes.

Canonical date object (all three keys required when supplied):

```json
{"mode":"none","start":null,"end":null}
{"mode":"single","start":"2024-02-29","end":"2024-02-29"}
{"mode":"range","start":"2024-02-28","end":"2024-03-01"}
```

Calendar values are YYYY-MM-DD, years 0001–9999, valid Gregorian dates. No timestamp or timezone conversion. Single requires identical boundaries; range requires both, start<=end. Map from/to accept independent inclusive bounds: Visit end>=from and Visit start<=to. Any active bound excludes undated Visits; reversed/invalid bounds return 400.

Place DTO: `{id,countryCode,countryName,city,region,approximateCoordinates,source,createdAt}`. region is the GeoNames admin1 code (not a translated region label), approximateCoordinates is null or `{lat,lng}`, source is `{provider,id,url}`. Points are independently sourced catalog approximations, never private Visit GPS. Attribution/licensing and scope: [catalog](../backend/catalog/README.md). Initial snapshot supports only COL/TUR/USA, six localities; no worldwide coverage. countryCode is required for Place search, uppercase alpha-3; invalid/unsupported codes return 400. query is optional literal case-insensitive substring (max 100 Unicode code points, control characters rejected); accents are not transliterated and `%`/`_` are literal. No matches returns an empty page. Ambiguous names return distinct candidate UUIDs, never an automatic selection. Search exposes no Visit counts, users, private suggestions or travel-dependent ranking.

Visit DTO: `{id,tripId,placeId,createdByUserId,name,status,place,confirmedCoordinates,date,photoCount,previewPhotoId,createdAt,updatedAt}`. Map item: `{visitId,tripId,place,confirmedCoordinates,date,photoCount,previewPhotoId,createdAt}`. The map represents each Visit independently, even at the same Place; no merged travel identity or invented boundaries. Guest DTOs omit Project metadata/roster and other Trips; no membership emails. All photoCount values are 0 and previewPhotoId null until photos exist. confirmedCoordinates is always null in E2.2. All operational timestamps are UTC strings; date boundaries are calendar strings/null.

Each list/map returns `{items,nextCursor}`. limit defaults 25, max 100; opaque cursor retains the existing `(createdAt,id)` format (map uses visitId as the cursor ID). Ordering is ascending `(created_at,id)`. Place search is country-scoped; Visit list is Trip-scoped. Map accepts countryCode, from, to, and (Project map only) tripId, plus limit/cursor. Trip filter must belong to the authorized active Project; hidden/foreign/unknown Trip filter returns 404. Unsupported/duplicate filters return 400. No totals, unbounded aggregates or facets. Pagination is not a cross-request snapshot; reauthorization and resource filtering happen before each page.

All routes retain E1 session validation, private/no-store/CSP headers and error normalization. POST/PATCH require exact Origin and session-bound X-CSRF-Token. 401 invalid/missing/revoked/expired auth; 403 forbidden modification of a visible Visit; 404 hidden/foreign/inactive resource; 400 validation; 409 recognized transaction conflicts; 503 dependency unavailable. Existing E1 rate limits/429 behavior remain unchanged. SQL authorization applies independently of HTTP validation through the same four-function runtime boundary. No GPS/request-body/audit logging is added.

D1 exact-point policy is pending, not inferred: database fields are constrained null. Enablement requires an approved confirmation actor, visibility audience, edits/reconfirmation, consent withdrawal/revocation and projection contract, plus a later migration. Evidence: [E2_2_VALIDATION](../backend/E2_2_VALIDATION.md). Migration 0004 is not automatically applied to persistent travel_map_dev.

## E2.3 implemented collaboration contract — 2026-11-05

These nine routes require migration 0005 (currently validated only in disposable
local databases). E1 authentication, secure cookies, exact Origin and X-CSRF-Token
remain unchanged. All actors are resolved by SQL from the current opaque session.

| Method/path under `/api/v1` | Authorization | Success |
|---|---|---|
| GET `projects/{projectId}/members` | Active Project Owner/Admin | 200 management roster page |
| POST `projects/{projectId}/members/{userId}/promote-admin` | Owner; target active Member | 204 |
| POST `projects/{projectId}/members/{userId}/remove-admin` | Owner; target active Admin | 204, becomes Member |
| DELETE `projects/{projectId}/members/{userId}` | Owner for non-Owner; Admin for ordinary Member | 204 soft revocation |
| POST `projects/{projectId}/leave` | Active Member/Admin, never Owner | 204 |
| DELETE `trips/{tripId}/members/{userId}` | Active Project Owner/Admin | 204 explicit Guest grant revoked |
| POST `trips/{tripId}/leave` | Active explicit Guest without inherited access | 204 |
| PATCH `projects/{projectId}` | Owner/Admin | 200 existing Project DTO |
| POST `projects/{projectId}/archive` | Owner | 204 |

Roster: `{items:[{userId,displayName,role,createdAt}],nextCursor}`. Role is
`owner|admin|member`; Owner is derived from Project, never a second membership.
Only active accounts/memberships appear; no email, Guest roster, revoked identities
or private account profile. Standard `limit` (default 25/max 100) and cursor convention
applies, ordered by membership creation time then userId (Owner uses Project creation
time). Cursor is a position, not authority; scope/role checks precede projection.

PATCH accepts a nonempty JSON object containing only `name` and/or
`tripCreationPolicy`. Name is trimmed, 1–200 Unicode scalar characters, no control
characters; policy is `admins_only|all_project_members`. Omitted values remain
unchanged. Body budget 4096 bytes. Dedicated POST/DELETE actions accept an empty body
or `{}` only; reject role/actor/status payloads, any other fields and query parameters.
No ownership assignment, privileged defaults, bulk grants or creation of memberships.

Project removal/leave revokes every active explicit Trip grant under that Project
(including inactive Trips) in the same transaction. Content/creator IDs are retained.
Trip leave does not modify Project membership and is forbidden for inherited access.
Revoking an explicit grant never suppresses independent active inheritance.

403 means a forbidden action on a visible resource (e.g. Member managing roles or
Owner attempting to leave). 404 conceals unknown/inaccessible/inactive parents or
missing/revoked target grants. An authorized Owner repeating a promotion of an
already-Admin or demotion of an ordinary Member gets 409. Repeated removal is 404.
Malformed payloads are 400; missing/expired/revoked sessions 401; unexpected database
failures 503 with static messages. Lock/serialization conflicts from domain operations
return 409; dispatcher/transport failures retain the established 503 boundary.

Archive hides Project/Trips/Visits/maps and blocks subsequent content/membership
writes; rows, attribution and unrelated sessions remain. Repeated archive is 404.
**There is no restore/list-archived API or shortcut.** P-01b approves Owner/Admin
restoration rights only for a future workflow. E2.4 invitations, ownership transfer,
Trip archival, Visit deletion and audit-reading endpoints are not implemented.
