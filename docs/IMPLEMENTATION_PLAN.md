# Travel Map — Plan de implementación del MVP

**Versión:** 0.1 — 2026-11-01  
**Estado:** APROBADO COMO SECUENCIA PROPUESTA DE DESARROLLO; no implica despliegue ni autorización para crear recursos pagos.  
**Documentos de entrada:** `PRD.md`, `DATA_MODEL.md`, `AUTHORIZATION_MATRIX.md`, `ADR-001-STACK.md`, `API_CONTRACT.md`, `FRONTEND_AUDIT.md`, `POC_RESULTS.md`.

## Principio de ejecución

**Se cierra la fase de comparación A/B.** No crear nuevas PoC para escoger entre D1 y PostgreSQL. Trabajar sobre un solo backend en producción futura: **Workers/TypeScript + Supabase PostgreSQL/Auth + R2/Images**. Las pruebas ahora son parte normal de desarrollar funcionalidades; los riesgos residuales son tareas de aceptación antes de activar la beta, no un argumento para suspender todo el trabajo.

Se mantiene frontend React/TypeScript/Leaflet existente. Su dataset estático puede permanecer durante desarrollo como demo, pero **no se migra** a nuevas cuentas y no es fuente autorizada después de integrar el backend. No reutilizar rutas `/harness/*`, sesiones simuladas ni credenciales de las PoC en la aplicación.

## Entregas incrementales

### E0 — Preparación y estructura reproducible

**Objetivo:** crear API y herramientas de desarrollo sin tocar código visual del frontend.

- Revisar estructura real del repositorio y convenciones existentes; crear `backend/` para Worker TypeScript con límites modulares, no microservicios.
- Elegir y documentar dependencias reales mínimas tras revisar compatibilidad Workers; no incorporar un SDK que dependa de APIs Node no soportadas.
- Configuración local con variables de entorno ignoradas; `.env.example` **sin secretos**; entornos `dev`, `test`, futuro `prod` separados.
- Especificar migraciones SQL PostgreSQL (nunca alterar BD de terceros), ejecución y reversibilidad. Iniciar tablas `users`, `projects`, `project_memberships`, `app_sessions` y extensiones mínimas necesarias; respetar la titularidad única.
- Rutas `GET /health` y respuesta de error normalizada; test runner y scripts de lint/typecheck/test desde backend.
- Mantener infra local ya existente donde sea segura; si falta un entorno usar instalación aislada con aprobación del sistema, sin Docker obligatorio para avanzar.
- Pruebas: arranque de Worker, migración inicial desde BD vacía, API sin sesión denegada, secretos ausentes del build y commit.

**DoD E0:** Worker local reproducible, migraciones aplicables en BD **descartable**, tests mínimos y documento de arranque; frontend visual intacto. **Sin despliegue.**

### E1 — Identidad y primer flujo real de datos

- Integrar Supabase Auth para Google-only; implementar con biblioteca madura y validación de state/nonce/PKCE/callback según flujo seleccionado.
- Sesión opaca de servidor: cookie segura, digest token, revocación duradera y consulta autorizada; protecciones CSRF/Origin; no añadir passwords propios.
- Registro/adaptación de `User` desde identidad estable del proveedor.
- `GET /me`, `POST /auth/logout`, `GET/POST /projects`; propietario único, política configurable de creación de viajes.
- Pruebas normales de desarrollo: sesión ausente/revocada; no acceso cruzado; el primer usuario crea proyecto y lo puede listar tras autenticar; logout impide siguiente acceso privado; proyectos persisten después de nueva sesión.

**Dependencia externa:** para comprobar Google Sign-In de extremo a extremo será necesario crear/configurar un proyecto Supabase y un cliente OAuth de Google, **solo con permiso explícito**. Hasta entonces construir componentes y pruebas locales, y etiquetar la validación alojada como pendiente; no reemplazar el flujo público por mock permanente.

**DoD E1:** primer flujo privado completo de usuario→proyecto, incluido estado/sesiones reales en entorno aprobado, sin acceso a datos ajenos.

### E2 — Núcleo del dominio y datos geográficos

- Migraciones y servicios para `Trip`, `Visit`, `Place` y membresías necesarias; índices por pertenencia/alcance y país/ciudad.
- Proyecto con varios viajes; configuración `admins_only`/`all_project_members`. Creador de visita u O/A puede editarla; terceros miembros no.
- Visitas repetidas en la misma ciudad sin fusionar; fechas none/single/range, sin convertir días calendario a UTC.
- Contratos de mapa general por proyecto y de viaje; filtros de país, viaje e intervalo solapado, con autorización **antes** de incluir o contar.
- Si proveedor del catálogo geográfico aún no existe, usar normalización controlada sin inventar ciudad de un tercero; no bloquear resto del CRUD por geocodificación precisa.
- Pruebas: invitado no obtiene viajes/visitas ajenos; 2 visitas a Bogotá siguen independientes; filtro de fecha omite fechas ausentes cuando se activa.

**DoD E2:** API de proyectos/viajes/visitas/mapa con autorización probada y respuesta apta para integrar Leaflet.

### E3 — Integración incremental del frontend

**Decisiones aprobadas para E3.1:** D-E3-01 exige un único origen HTTPS para
interacciones autenticadas; D-E3-02 mantiene la demo estática aislada de datos
privados; D-E3-03 permite diseñar contratos de Trip sin asumir acceso al Project
padre; D-E3-04 utiliza un cliente API pequeño y patrones React estándar, sin nueva
dependencia de estado global. E3.1 implementa únicamente transporte/DTOs y
verificación local de lectura; navegación, pantallas de sesión, selector visual
demo/live y adaptación del mapa quedan para incrementos posteriores. Evidencia y
criterios pendientes en [E3_1_VALIDATION.md](E3_1_VALIDATION.md).

**E3.2 aprobado:** D01 conserva el mapa como centro de la aplicación, sin marcadores
privados ni recuerdos demo; D02 permite formularios mínimos de Project/Trip con
las políticas de creación vigentes; D03 usa History API y acceso directo a Trip
sin lectura obligatoria de Project; D04 mantiene React/cliente ligero sin router
ni estado global adicional. Sesiones/Google/logout siguen siendo autoridad del
backend. Implementación y aceptación local en [E3_2_VALIDATION.md](E3_2_VALIDATION.md).
No implica autorización para E3.3, visitas/mapas privados ni despliegue.

**E3.3 autorizado por separado:** integrar únicamente el catálogo Places y el
listado/creación/detalle/edición de Visits dentro de Trip, con fechas de calendario
y autorización vigente del servidor. Conservar rutas de E3.2, Guest sin contexto
privado del Project y demo aislada. Sin cambios de backend/migraciones, coordenadas
exactas, marcadores E3.4 ni fotos E4. Evidencia actual:
[E3_3_VALIDATION.md](E3_3_VALIDATION.md).

**E3.4 autorizado por separado:** consumir proyecciones de mapa autorizadas por
Project/Trip, adaptar únicamente coordenadas aproximadas del catálogo y conservar
cada Visit independiente al agrupar marcadores. Filtros y paginación proceden del
API existente; un Guest no necesita leer el Project padre. Integración con detalle
de Visit sin recorrer todas sus páginas. Solo frontend, sin backend/migraciones,
GPS exacto, medios ni E3.5/E4. Evidencia y aceptación pendiente:
[E3_4_VALIDATION.md](E3_4_VALIDATION.md).

- Crear cliente API tipado y adaptadores; desacoplar `WorldMap` de `trips.ts` estático sin reescribir componentes visuales.
- Navegación de sesión, proyectos, viajes y estados loading/empty/error. Conservar temporalmente demo estática detrás de selector de desarrollo, **no** mezclarla con datos privados en producción.
- Mapa y galerías solo consumen datos autorizados del backend. Responsive a 360/768/1440; controles accesibles.
- Pruebas de integración de mapa proyecto/viaje, logout que vacía datos privados y acceso directo a IDs ajenos.

**DoD E3:** el usuario autorizado puede entrar, crear proyecto/viaje/visita y ver el marcador desde los datos persistidos, sin foto todavía.

### E4 — Fotografías privadas y cuotas

- Configurar adaptador de almacenamiento privado; **antes de R2 real**, desarrollo local con el mismo contrato abstracto.
- Implementar `Photo`, `PhotoAsset`, `UploadOperation`, reservas de 500 MB/usuario y máximo 10 archivos/20 MB por archivo; original + derivados cuentan; idempotencia bajo concurrencia.
- Añadir subida por archivo con progreso, parcialidad 7/3 y reintentos solo fallidos; fotografía no visible como lista hasta que activos exigidos estén listos.
- Usar Images binding en entorno permitido para derivados sin GPS y WebP. Conservar HEIC/HEIF en el requisito: si falla, tratar como bloqueo de aceptación del upload de ese formato y utilizar adaptador alternativo antes de declarar FR-05 terminado.
- EXIF solo propone fecha/localización con confirmación; originales privados y rutas de media autorizadas por sesión/membresía/autoria.
- Papeleras 30 días sin liberar cuota antes de purga; procesos seguros y documentados para restauración, vencimientos, fallo intermedio y reconciliación entre PostgreSQL/R2.
- Pruebas: archivos falsos, límites reales, foto de usuario expulsado, privado/original, pérdida de sesión, carreras de cuota y reintentos, EXIF metadata y recuperación de fallos.

**Dependencia externa:** activar R2/Images en Cloudflare requiere consentimiento específico del usuario y, en R2, checkout de suscripción. No habilitar facturación automáticamente.

**DoD E4:** subir, visualizar, descargar con permisos, reintentar, borrar/restaurar y contabilizar fotos sin fuga de metadatos. Probar HEIC/HEIF real antes de cerrar esta entrega.

### E5 — Colaboración y salvaguardas

- Invitaciones por enlace al proyecto o viaje; tokens secretos hash, un uso, siete días, revocables; canje autenticado atómico.
- Roles owner/admin/member/guest y herencia; **solo owner** administra administradores y archiva proyecto.
- Procesos asistidos y auditados para salir del proyecto, retirar aportes, transferir propiedad/cuota y eliminar cuenta, respetando fotos de otras personas y consentimiento.
- Acciones pendientes en `AUTHORIZATION_MATRIX.md` se definen antes de implementar rutas sensibles, o se conservan denegadas de forma segura. No fabricar autorizaciones por defecto.
- Pruebas de recursos/navegación/medios y de agregados privados con cuentas de roles distintos.

**DoD E5:** colaboración real sin ampliación accidental de acceso o purga de terceros.

### E6 — Beta privada con 3–5 personas

- Respaldo/restauración documentados y ejecutados con datos de prueba, tanto SQL como objetos.
- Seguridad: prueba real Google OAuth, revocación y sesiones, EXIF, privacidad de R2, límites de 20 MB y límites 500 MB; cumplimiento de NFR de mapa 100 visitas/4 s en perfil móvil/4G definido.
- Monitoreo y límites de uso/costo; procedimiento ante pausa Supabase Free. No declarar garantía de disponibilidad ni pagar Pro automáticamente.
- Documentar política real de 30 días, destrucción de archivos, respaldo y derechos de colaboradores.

**DoD E6:** FR/NFR del PRD verificadas y beta invitada sin exposición de datos.

## Orden de trabajo que debe ejecutar Codex AHORA

**Iniciar únicamente E0.** Codex debe:

1. Leer primero todos los docs anteriores y auditar `git status` y la estructura existente.
2. Resumir en pocas líneas la estructura que va a crear; luego **crear efectivamente** el código inicial del Worker y migraciones SQL locales.
3. No pedir selección del framework entre D1/PostgreSQL ni crear más PoC comparativas.
4. No editar frontend visual, ni desplegar ni crear proyectos cloud ni habilitar R2/Supabase alojado ni pagos.
5. Elegir dependencias mínimas adecuadas para Workers (documentar cada decisión); tests básicos obligatorios.
6. Registrar instrucciones de ejecución y comandos. No copiar prototipos inseguros de `spikes/` al backend de producción; usarlos como evidencia de qué invariantes probar.
7. Ejecutar lint, typecheck y test; informar resultados reales y limitaciones.
8. No realizar commit ni push; entregar resumen de archivos, comandos y siguiente incremento E1.

## Seguimiento de trabajo y control de cambios

- Un commit por entrega o por subhistoria coherente, revisado por el propietario. Evitar cambios enormes de backend+frontend a la vez.
- Cada PR incluye criterios de aceptación, rutas modificadas, cambio de esquema/migración, tests relevantes, efectos de seguridad y costos.
- Si una integración externa requiere secreto, autorización de recursos o cobro, parar **solo esa acción**, continuar trabajo local viable y reportar claramente el bloqueo.
- Dejar rastro de qué requisitos son aprobados y qué defaults técnicos siguen provisionales; PRD es la autoridad de producto.
