# Travel Map — Plan de pruebas de concepto de arquitectura (PoC)

**Versión:** 0.1 — plan de validación, no implementación.  
**Fecha:** 2026-11-01.  
**Decisión origen:** #39 — comparar Cloudflare integrado (A) con Cloudflare + Supabase (B).  
**Estado:** listo para revisión. **No aprueba desplegar recursos, gastar dinero, crear credenciales ni modificar el backend de producción.**

## 1. Propósito y límites

Determinar si A o B puede sostener el MVP aprobado con **3–5 usuarios**, costo objetivo **USD 0–10/mes**, fotografías originales/optimizadas privadas, Google Sign-In, permisos de proyecto/viaje, cuotas y recuperaciones. No seleccionar una alternativa por preferencia de lenguaje sin evidencia.

**Fuentes de verdad internas:** `docs/PRD.md`, `docs/DATA_MODEL.md`, `docs/AUTHORIZATION_MATRIX.md`, `docs/FRONTEND_AUDIT.md`, `docs/ARCHITECTURE.md`. Las reglas de producto aprobadas prevalecen sobre las hipótesis de la PoC; las decisiones aún abiertas se reportan, no se inventan.

**Fuera de alcance:** backend de producción, migraciones permanentes, diseño visual nuevo, pagos, email de invitaciones, explorador global por ciudades, integración con la app real, datos/fotos personales de usuarios, dominio propio, infraestructura siempre encendida y lanzamiento público.

**Principio de paridad:** ejecutar las mismas pruebas, fixtures y criterios de aceptación en ambas opciones. Usar carpetas y recursos aislados. Es válido compartir scripts de prueba, definiciones de casos y archivos sintéticos, pero **no** modificar `frontend/src`, PRD ni los archivos de configuración de producción.

## 2. Dos candidatos y límites de la comparación

| Dimensión | A — Cloudflare integrado | B — Cloudflare + Supabase |
|---|---|---|
| API | Cloudflare Worker, TypeScript | Cloudflare Worker, TypeScript |
| Identidad | Google OIDC + sesión administrada por la aplicación mediante biblioteca auditada (no criptografía propia) | Supabase Auth + Google OIDC; Worker verifica la identidad y aplica permisos |
| Datos estructurados | Cloudflare D1 (SQLite compatible) | Supabase PostgreSQL |
| Originales y derivados | Cloudflare R2 privado | Cloudflare R2 privado |
| Procesamiento | Cloudflare Images binding (si pasa la PoC) | El **mismo** Cloudflare Images binding |
| Riesgo diferencial | Complejidad de identidad/sesiones propias; D1 y concurrencia | Dependencia de dos proveedores; inactividad y cambios de plan gratuito |
| Riesgo compartido | HEIC/HEIF, EXIF, privacidad, 20 MB límite, caché de fotos, costos de transformación | Los mismos riesgos; **Supabase no resuelve por sí solo el procesamiento** |

**No se seleccionan aún** framework HTTP interno, ORM, paquetes de OAuth, cliente SQL, estrategia de sesión ni API definitiva. Las pruebas permiten escoger bibliotecas solo dentro de una PoC aislada y con justificación.

## 3. Condiciones de seguridad antes de ejecutar pruebas

- Primera fase: **local o simulada**, sin credenciales reales y usando datos sintéticos. Segunda fase: servicios cloud en cuentas/proyectos **sandbox**, solo tras autorización expresa del usuario.
- No solicitar ni guardar secretos en Markdown, capturas, logs, commits o mensajes. Configuración mediante secretos administrados y archivos locales ignorados, nunca `VITE_*` para credenciales privadas.
- No desplegar en la cuenta actual de producción ni tocar el frontend/hosting público existente.
- Bucket R2 privado (no `r2.dev` público, ni objetos de PoC publicados). Limitar permisos por recurso; URLs firmadas de mínima duración y ámbito.
- Usar **imagen HEIC de prueba** con coordenadas GPS ficticias, no fotografías personales. Verificar el derivado con un inspector de metadatos independiente.
- No ejecutar operaciones destructivas sobre bases de datos o buckets existentes. Las limpiezas solo sobre recursos desechables de la PoC.
- No activar planes de pago ni métodos de facturación sin permiso adicional. Registrar cuotas y detener pruebas ante una señal de consumo inesperado.
- Si se requieren credenciales Google/OAuth, documentar los pasos de configuración para que el propietario las establezca localmente; Codex no debe pedirlas en el chat ni imprimirlas.

## 4. Secuencia de trabajo recomendada

**Fase 0 — Contrato y fixtures, sin cloud.** Establecer conjunto de pruebas reutilizable: propietario, administrador, miembro, invitado a un solo viaje y tercero sin acceso; dos viajes en un proyecto; fotografías de autores distintos; visitas repetidas a Bogotá y un `Place` compartido; foto HEIC sintética con GPS; carga fallida y carga duplicada intencional. Definir identificadores y resultados esperados, sin fijar API de producción.

**Fase 1 — Pruebas locales de seguridad/integridad.** Simular autenticación con identidades de prueba (sin fingir que equivale a Google real); implementar lo mínimo para evaluar reglas y transacciones de cuota. D1 local vs PostgreSQL local si la configuración lo permite. Registrar diferencias de semántica. Un test local exitoso **no** prueba el servicio cloud ni su nivel gratuito.

**Fase 2 — Sandboxes remotos, solo tras aprobación.** Configurar A y B en proyectos aislados de uso gratuito, comprobar autentificación real Google mediante cuentas de prueba, R2 privado, imágenes HEIC y concurrencia remota. Anotar dificultades de configuración y costos/uso. No modificar el frontend de Travel Map ni publicar enlaces de imágenes.

**Fase 3 — Comparación y decisión.** Ejecutar pruebas idénticas, escribir evidencia reproducible, calificar riesgos y producir un ADR de selección (o dejar la decisión abierta si falta evidencia). Eliminar recursos de prueba cuando el usuario lo apruebe y sea seguro.

## 5. Pruebas con criterios de aceptación (iguales para A y B)

| ID / prioridad | Escenario | Evidencia exigida / condición de salida |
|---|---|---|
| POC-01 / Bloqueante | **Identidad y sesión**: Google Login real, sesión válida/inválida, cierre de sesión, retorno desde invitación | El backend verifica identidad autenticada; solicitudes sin sesión o con token inválido no leen datos privados. Registrar cómo se renuevan/revocan credenciales. En A, cubrir OAuth `state`, PKCE/nonce cuando corresponda y protección CSRF; en B, verificación JWT fiable, no solo decodificarlo. |
| POC-02 / Bloqueante | **Autorización**: invitado de Italia intenta acceder a Colombia por URL/ID directo y consulta de mapa, conteos, miniaturas y original | Ningún dato no autorizado (incluidos agregados y metadatos) aparece en respuesta. Debe verificarse del lado del Worker y de la base de datos según el diseño, no en React. |
| POC-03 / Bloqueante | **Original privado y derivado**: cargar HEIC con GPS sintético, producir WebP y recuperar según permiso | El original no está disponible anónimamente. El WebP es visualizable y no contiene GPS ni EXIF sensible. Acceso original: autor o administrador autorizado vigente; usuario externo denegado. Mostrar inspección del derivado, no solo confianza en configuración del proveedor. |
| POC-04 / Bloqueante | **Límite de archivos**: JPEG, PNG, WebP, HEIC/HEIF y tamaños próximo/al máximo de 20 MB; detectar contenido disfrazado | Documentar los formatos realmente aceptados y límites exactos en bytes; si HEIF distinto de HEIC o archivo de tamaño límite falla, dejar el bloqueo explícito. No reducir silenciosamente el requisito aprobado. |
| POC-05 / Bloqueante | **Cuota bajo concurrencia**: 480 MB ocupados; dos cargas simultáneas con reserva estimada de 17 MB cada una sobre cuota 500 MB | Solo una reserva puede tener éxito, nunca se superan 500 MB considerando uso + reservas. Fallo/cancelación libera reserva; finalización registra bytes reales. Repetir con procesos separados/solicitudes concurrentes, no solo ejecución secuencial. Valores en bytes definidos explícitamente en la prueba. |
| POC-06 / Bloqueante | **Idempotencia y fallos parciales**: lote de 10, 7 éxitos y 3 fallos; reintento; doble solicitud idéntica | Se conservan siete; solo se reintentan tres; no se crean fotos ni cargos duplicados por reintento. Una nueva carga intencional del mismo archivo es un evento diferente. |
| POC-07 / Alta | **Invitaciones**: canje autenticado, token único de 7 días, doble canje concurrente y revocación | Un solo canje exitoso; invitación caducada/revocada no habilita acceso; nunca se guarda el token en claro en logs o base de datos. |
| POC-08 / Alta | **Revocación de medios**: se revoca membresía con galería abierta; probar nuevos GET y caché | No se emiten nuevas autorizaciones ni se sirven nuevos objetos protegidos tras revocación; describir la ventana de exposición de URLs firmadas emitidas previamente. No prometer revocar bytes ya descargados. |
| POC-09 / Alta | **Recuperación y consistencia**: borrado lógico y restauración a 30 días, reconciliación entre DB y R2, restauración desde respaldo | Demostrar estados de papelera sin confundirlos con Time Travel de D1 ni respaldos operativos; documentar una restauración verificable de metadatos y archivos sintéticos. Si no es viable en free tier, clasificar como riesgo/bloqueo. |
| POC-10 / Alta | **Consulta geográfica**: dos viajes con visitas a Bogotá y Colombia; un invitado puede ver solo un viaje | Las visitas conservan IDs diferentes y comparten `Place` cuando corresponde; el conteo/filtro devuelve únicamente fotos autorizadas sin duplicarlas. Puede probarse a nivel de datos, sin implementar interfaz global. |
| POC-11 / Alta | **Costos y límites**: calcular almacenamiento, API, transformación, transacciones y picos | Tabla de cuotas consumidas y estimación mensual para 3–5 usuarios; indicar lo gratuito, lo que bloquea por exceso y lo que puede generar facturación. Registros de medición/console sin secretos. |
| POC-12 / Media | **Experiencia y rendimiento**: consulta sintética de 100 visitas y procesamiento de 10 fotos | Medir tiempos de API, procesamiento y tamaño transferido; el objetivo de primera vista útil ≤4 s corresponde a integración posterior con el frontend bajo perfil móvil/4G reproducible. No declarar aprobado NFR-01 con solo medir la API. |

**Un fallo en un bloqueo P0** invalida al candidato para seleccionar producción **sin una alternativa documentada y nueva prueba**. Si las dos opciones fallan en Images/HEIC, se vuelve a evaluar procesamiento externo/convencional; elegir B no arregla un riesgo que comparte con A.

### Casos fronterizos que no deben omitirse

- Archivo de 19,9 MB, 20 MB y ligeramente superior: indicar si se utiliza MB decimal (1.000.000 bytes) o MiB; tomar **20.000.000 bytes como hipótesis de prueba**, sin cambiar el PRD por inferencia.
- La entrada del Images binding tiene máximo declarado de 20 MB. Probar desde R2 privado y directamente desde request sin hacer pública la fuente.
- WebP derivado y original requieren políticas de acceso distintas; **WebP descarta metadatos en las transformaciones documentadas**, pero verificar el resultado real.
- El binding no debe confundirse con un extractor EXIF GPS: lectura de sugerencias antes de la conversión es un requisito separado que podría requerir otra biblioteca/servicio.
- R2 URLs presignadas son credenciales bearer hasta su vencimiento; no hay revocación inmediata garantizada de enlaces previamente emitidos.
- D1 Free ofrece 7 días de Time Travel; **el producto exige 30 días de papelera**, que debe modelarse explícitamente y no depender de Time Travel.
- Supabase Free puede pausar proyectos por inactividad; probar y documentar la recuperación/impacto en la beta.

## 6. Medición de costos: hipótesis de referencia

**Escenario para proyección, no predicción:** cinco cuentas gratuitas × 500 MB de cuota de producto = **hasta 2,5 GB de archivos computables** en total, incluyendo originales, derivados y papelera. No contabiliza respaldo interno, versiones accidentales, archivos huérfanos, metadatos de DB ni crecimiento público. R2 Standard incluye actualmente 10 GB-mes gratis, pero no equivale a costo final cero garantizado.

| Métrica | Captura requerida |
|---|---|
| Workers | Solicitudes, CPU por invocación, subsolicitudes y errores por límites |
| D1 o Supabase | DB almacenada, lecturas/escrituras o consultas, latencia, conexiones/efecto de pausas |
| R2 | GB-mes, operaciones de escritura/lectura, cargas abortadas/huérfanas |
| Images | Transformaciones únicas, errores de formato/20 MB, comportamiento al alcanzar cuota |
| Identidad | Solicitudes/MAU, gestión de Google callback, renovaciones de sesión |
| Respaldo | Ubicación y tamaño adicionales, operaciones de recuperación |
| Crecimiento | Modelo de costo para 5, 100 y 1.000 usuarios sin asumir que todos consumirán toda la cuota |

La estimación debe mostrar costos **fijos**, **variables**, límites duros y condiciones de upgrade. No activar un upgrade automáticamente ante límites. Si se agota Images Free, puede **fallar una nueva transformación**; nunca servir el original privado sin autorización como atajo.

## 7. Comparación con puntuación (propuesta para revisión)

Calificar cada dimensión de **0 a 5** usando pruebas y evidencia; `N/D` si no se probó. La puntuación ponderada no sustituye las condiciones de bloqueo.

| Dimensión | Peso | A | B |
|---|---:|---|---|
| Seguridad: autenticación, permisos, acceso a medios | 30% | N/D | N/D |
| Medios: HEIC, EXIF, privados, reintentos | 25% | N/D | N/D |
| Integridad de datos: cuota, atomicidad, recuperación | 20% | N/D | N/D |
| Operación: reproducibilidad, complejidad, respaldo | 15% | N/D | N/D |
| Costo y crecimiento dentro del presupuesto | 10% | N/D | N/D |

**Regla de decisión:** todos los P0 aprobados, ausencia de exposición de datos privados, costos iniciales medidos/estimados ≤ USD 10/mes y plan de recuperación operativo. Si una dimensión es `N/D`, no fabricar una nota ni proclamar ganador.

## 8. Artefactos y reporte exigido a Codex

**Antes de desplegar nada**: proponer carpeta aislada `spikes/cloudflare-only/` y `spikes/cloudflare-supabase/`, un conjunto compartido de fixtures y `docs/POC_RESULTS.md` con resultados diferenciados por opción. El nombre de carpeta es sugerido; requiere aprobación antes de escribir código.

Cada resultado debe contener:
1. Escenario, versión/fecha, comandos, entorno local/remoto y recursos utilizados.
2. Evidencia de entrada (datos sintéticos), resultado esperado, resultado observado, pass/fail/bloqueado.
3. Medidas de latencia/costo; errores reales; limitaciones de la prueba.
4. Evidencia de privacidad/EXIF y de concurrencia, sin publicar secretos o fotos privadas.
5. Hallazgos específicos de A o B y riesgos compartidos.
6. Recomendación para ADR-001/002/003/004 y decisión de siguiente hito.

**Entregable de esta etapa:** este documento de plan. **No** se han ejecutado las PoC, creado carpetas de código, configurado servicios cloud ni registrado resultados.

## 9. Condiciones para pasar a implementación del backend

- Elegir y aprobar proveedor/runtime/DB/identidad/procesamiento mediante ADR respaldado por las PoC.
- Documentar en `docs/API_CONTRACT.md` contratos de errores, respuestas, sesión, autorización, cargas y medios.
- Revisar/actualizar `docs/ARCHITECTURE.md` y el plan de implementación; resolver o registrar explícitamente riesgos no bloqueantes.
- Mantener intacto el frontend hasta una tarea aprobada de integración; añadir controles de pruebas/CI gradualmente.

## 10. Referencias verificadas (2026-11-01)

- Workers: https://developers.cloudflare.com/workers/platform/pricing/ ; https://developers.cloudflare.com/workers/platform/limits/
- D1 límites: https://developers.cloudflare.com/d1/platform/limits/ ; operaciones `batch`: https://developers.cloudflare.com/d1/worker-api/d1-database/
- R2 precios y URLs: https://developers.cloudflare.com/r2/pricing/ ; https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Images (binding/formatos/metadatos/precios): https://developers.cloudflare.com/images/optimization/binding/ ; https://developers.cloudflare.com/images/get-started/limits/ ; https://developers.cloudflare.com/images/optimization/features/ ; https://developers.cloudflare.com/images/pricing/
- Supabase: https://supabase.com/pricing ; https://supabase.com/docs/guides/auth/social-sign-in/auth-google ; https://supabase.com/docs/guides/auth/jwts
