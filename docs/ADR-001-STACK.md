# Travel Map — ADR-001: Stack del MVP y límites arquitectónicos

**Estado:** APROBADO COMO DIRECCIÓN DE IMPLEMENTACIÓN — decisión #40, 2026-11-01  
**Propósito:** terminar la comparación de plataformas y comenzar el desarrollo del MVP.  
**Autoridad:** decisión expresa de producto de continuar con una arquitectura, aceptando riesgos identificados.  
**Documento comparativo anterior:** `docs/ARCHITECTURE.md` v0.1 sigue siendo evidencia histórica, pero **sus opciones abiertas quedan reemplazadas por este ADR** en los aspectos aquí decididos.

## 1. Decisión

| Capa | Elección para MVP | Observaciones |
|---|---|---|
| Web | React + TypeScript + Leaflet + Vite, frontend existente | Evolución incremental; preservar diseño y componentes actuales. |
| API | TypeScript sobre Cloudflare Workers | Monolito modular; REST/JSON versionada en `/api/v1`; código de negocio independiente de bindings donde sea razonable. |
| Persistencia | PostgreSQL administrado por Supabase | Datos de dominio, transacciones de cuotas, operaciones de carga, sesiones y control de acceso. |
| Identidad | Supabase Auth con Google como único proveedor de acceso MVP | No crear passwords de aplicación. La integración OAuth definitiva se implementa con una librería auditada y protecciones de flujo. |
| Sesión de aplicación | **Sesión opaca revocable, cookie segura y estado autoritativo del lado servidor** | Preferencia elegida para acceso privado; no usar un JWT con firma válida como único criterio de lectura después de logout. Los detalles de biblioteca y bootstrap OAuth se cerrarán durante implementación y revisión de seguridad. |
| Permisos | Servicio central de autorización en Workers, respaldado por SQL y privilegios mínimos; RLS cuando se use acceso directo PostgREST | Cada acción, agregación, archivo original y derivado comprueba permisos actuales y estados de ancestros. |
| Archivos | Cloudflare R2 privado, clase Standard | Originales y derivados, sin bucket público y sin URLs permanentes. **No está activado aún**; empezar con interfaz de almacenamiento y adaptador local para desarrollo. |
| Transformación | Cloudflare Images binding, sujeto a compatibilidad real | HEIC/HEIF se mantienen como requisito; alternativa de conversión por adaptador si Images no cubre casos necesarios. No dar por resuelto en local. |
| Despliegue | Frontend en Cloudflare existente; Worker API y Supabase en entornos separados | No desplegar ni provisionar sin autorización. |
| Arquitectura | Monolito modular, sin microservicios para el MVP | Módulos: identity/session, projects/memberships, trips, visits/places, photos/uploads, quota, invitations, retention, observability. |

## 2. Justificación apoyada por PoC

- La prueba nativa de **Workers + D1** pasó 22/22 casos, y **Workers + PostgreSQL** pasó los mismos 22/22. Ambas opciones son viables para las reglas centrales probadas localmente; ninguna ganó por corrección funcional.
- **Supabase Auth y RLS** pasaron 11/11 pruebas locales, y la integración Worker/JWT pasó 3/3. Esto reduce trabajo propio en identidad y ofrece PostgreSQL para un dominio con relaciones, concurrencia y consultas geográficas compartidas.
- La prueba negativa mostró que verificación *offline* de JWT por sí sola permitió lectura posterior a logout. Se eligió un límite de sesión revocable del lado servidor, sin asumir que el simple uso de Supabase Auth lo resuelve.
- R2 e Images siguen siendo riesgo **compartido**: la simulación local no pudo decodificar HEIC; ello no demuestra fallo en la plataforma alojada. Se aceptó desarrollar la integración con pruebas ordinarias durante la implementación, sin otra fase previa de elección de stack.
- Las mediciones de latencia localhost no se toman como evidencia de rendimiento relativo en cloud.

## 3. Política de identidad y recursos privados

1. Google mediante Supabase Auth autentica la identidad de inicio de sesión. Un intercambio de login auditado y protegido crea una sesión propia de la API; el simple conocimiento de un antiguo JWT de proveedor no debe permitir recrear silenciosamente una sesión revocada.
2. La API mantiene un token opaco de al menos 256 bits de entropía en cookie `__Host-` segura, HttpOnly, Path=/, sin Domain; elegir SameSite y defensas CSRF/Origin según el diseño real de dominios. **No se exponen credenciales de Supabase elevadas a React**.
3. Al confirmar logout, se invalida duraderamente la sesión. La siguiente solicitud privada, incluida la entrega de imágenes, debe consultar estado de sesión y membresía y rechazar accesos revocados. No se garantiza borrar archivos ya descargados ni detener solicitudes iniciadas antes de la revocación.
4. Los permisos se calculan a partir de `Project`, `Trip`, autoría, roles, estados y relaciones vigentes; no se congelan en JWT ni en UI.
5. Los medios privados se sirven inicialmente mediante una ruta autorizada del Worker con `Cache-Control: private, no-store`; no se ofrecen URLs públicas ni firmadas persistentes. Las solicitudes sin alcance no deben revelar conteos ni existencia.
6. El acceso a datos de Supabase desde la API empleará **credenciales server-side de privilegio mínimo** o RPC específicas. Si se requiere una credencial que evita RLS, el Worker nunca la usará como sustituto de autorización de dominio. Prohibido exponer `service_role` al navegador.
7. Gestión de claves, rotación, rate-limiting, expiración/CSRF y pruebas de login forman parte de implementar el MVP, no de una nueva competición de proveedores.

**Propuesta técnica para arrancar, pendiente de detalles de implementación:** logout del dispositivo actual y opción de logout global; los valores de tiempo de inactividad y vida absoluta se documentarán con pruebas sin alterar silenciosamente requisitos de negocio.

## 4. Modelo y reglas de producto que el backend debe preservar

- Jerarquía `Project → Trip → Visit → Photo`, con `Visit → Place` para búsquedas futuras entre viajes por país o ciudad. No fusionar visitas repetidas ni duplicar fotografías para consultas.
- Visit compartida, edición de localización/fechas/borrado por creador o administrador autorizado; el acceso se pierde al salir aunque permanezca la autoría.
- Proyecto con propietario único y administradores; solo propietario cambia administradores o archiva el proyecto (decisión #38).
- Invitado a viaje: solo su viaje, sin conteos, facetas o fotos de los otros viajes del proyecto.
- Originales: solo autor con acceso vigente o administradores autorizados; derivados visibles a participantes autorizados. EXIF sensible no se publica por defecto.
- Google-only, 10 fotos por lote, máximo inicial 20 MB/archivo, cuota inicial 500 MB/usuario, papelera 30 días, reintentos idempotentes y contribuciones de terceros protegidas.
- Para la etapa inicial **interpretar MB de manera provisional como 1 000 000 bytes**, señalado como elección técnica a confirmar al cerrar el validador de carga; no cambiar límites aprobados ni eliminar HEIF por conveniencia.
- Explorador global entre proyectos por país/ciudad: esquema preparado ahora; interfaz y endpoint transversal **fuera del MVP**.

## 5. Operación y economía

- Objetivo de operación inicial: **USD 0–10 por mes**, con 3–5 participantes; no implica garantía de disponibilidad ni gasto cero.
- Supabase Free publicado: base de datos 500 MB, 50 000 MAU; proyecto puede pausarse por inactividad. El plan Pro empieza en USD 25/mes, por encima de la meta; la beta acepta esa limitación y no se actualizará a Pro automáticamente.
- Workers Free: 100 000 solicitudes/día, con límite CPU de 10 ms/solicitud; se evitarán decodificaciones pesadas dentro del Worker.
- R2 Standard tiene 10 GB-mes gratuitos sujetos a condiciones. Su activación requiere la suscripción/checkout de R2 y autorización manual del propietario de la cuenta. **No activar facturación ni crear bucket por cuenta de Codex sin consentimiento aparte**.
- Images binding soporta el acceso a bytes desde R2, pero la compatibilidad HEIC/HEIF y la eliminación efectiva de EXIF deben validarse en la integración real.
- Observar uso de base de datos, CPU/requests, R2, transformaciones y costos; fallar de forma controlada antes de aceptar nuevas cargas cuando se superan cuotas. Definir copia/exportación y recuperación probada antes de beta con colaboradores.

## 6. Opciones descartadas para iniciar el MVP

- **Workers + D1 + autenticación propia:** viable y más integrado, pero tras la evidencia local Supabase ofrece un camino de identidad administrada y PostgreSQL útil para este dominio. D1 queda como alternativa de contingencia, no como trabajo paralelo.
- **FastAPI/servidor Node always-on:** técnicamente viables, pero requieren nuevas decisiones de hosting y mayor superficie operativa frente a Workers para esta beta.
- **Microservicios:** complejidad prematura para 3–5 usuarios.

## 7. Riesgos aceptados y puntos de cambio

| Riesgo | Tratamiento durante el desarrollo |
|---|---|
| Proyecto Supabase Free pausado por inactividad | Documentar recuperación y avisos; no prometer uptime permanente a la beta; reabrir costos si pasa a público. |
| Plan Pro supera presupuesto | No auto-upgrade; revisión económica separada cuando uso/disponibilidad lo requiera. |
| HEIC/HEIF o 20 MB falla en Images alojado | Mantener contrato de formatos; introducir procesador alternativo detrás de interfaz, sin reescribir dominio/API. |
| No hay R2 habilitado todavía | Adaptador local/abstracto para desarrollo; activar manualmente solo antes de integración remota. |
| JWT/checkout/cookies/CSRF | Implementar flujo auditado con sesiones revocables y pruebas de seguridad obligatorias en desarrollo. |
| Supabase RLS bypass por service role | Credenciales mínimas server-side; SQL autorizado; pruebas negativas sobre accesos cruzados. |
| Reglas administrativas aún pendientes en matriz | Defaults *fail closed*, nunca elevar permisos sin decisión; separar administración avanzada del flujo principal. |
| Costos y recursos a escala | Instrumentar límites desde la primera integración; no anticipar una arquitectura enterprise. |

## 8. Consecuencias y siguiente trabajo

1. `docs/API_CONTRACT.md`: contrato HTTP v0.1 y formatos de respuesta, con rutas privadas, filtros y protocolo de carga.
2. `docs/IMPLEMENTATION_PLAN.md`: implementación vertical incremental, con pruebas de seguridad integradas en las historias normales de desarrollo.
3. Codex trabaja dentro del backend nuevo y capas de integración en fases autorizadas; conservar el frontend existente y sustituir progresivamente los datos estáticos por un adaptador de API.
4. Las pruebas restantes de medios, autenticación alojada, respaldo y costos son **criterios de aceptación de las funcionalidades** durante la implementación y antes de la beta, no una condición previa para volver a elegir tecnologías.

### Referencias de evidencia

- `docs/POC_RESULTS.md` (versión local nativa del 2026-11-01)
- `docs/NEXT_TECHNICAL_DECISIONS.md`
- `docs/PRD.md`
- `docs/DATA_MODEL.md`
- `docs/AUTHORIZATION_MATRIX.md`
- `docs/FRONTEND_AUDIT.md`
- Documentación oficial al 2026-11-01: https://supabase.com/pricing ; https://supabase.com/docs/guides/auth/sessions ; https://developers.cloudflare.com/workers/platform/pricing/ ; https://developers.cloudflare.com/r2/get-started/ ; https://developers.cloudflare.com/images/optimization/binding/
