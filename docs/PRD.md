# Travel Map — Product Requirements Document (PRD)

**Versión:** 1.0 — requisitos aprobados  
**Fecha:** 2026-10-31  
**Estado:** Aprobado para planificación técnica; sujeto a validaciones de viabilidad señaladas  
**Alcance:** MVP web responsive, beta privada de 3–5 personas  
**Restricción económica:** objetivo de USD 0–10/mes inicialmente

## 1. Problema y propuesta de valor

Los álbumes tradicionales organizan fotos, pero no facilitan construir **un historial geográfico y colaborativo de recuerdos**. Travel Map permitirá crear proyectos personales o compartidos, registrar viajes y visitas, asociar fotografías a lugares y explorarlas sobre un mapa minimalista.

**Resultado principal:** una persona puede iniciar sesión, crear un proyecto y un viaje, añadir una visita con fotografías, visualizarla en el mapa e invitar a otra persona a aportar recuerdos al mismo viaje.

**Estrategia de producto:** beta privada → registro público gratuito → monetización eventual mediante membresías u otras formas por validar. El MVP es también un proyecto de portafolio.

## 2. Contexto y restricciones

- Existe un frontend presumiblemente construido con **React y Leaflet**, con mapa de países y datos estáticos. **No se ha auditado el repositorio**; la implementación exacta es un supuesto pendiente de verificación.
- Se reutilizará el frontend viable; **no habrá migración** de las fotografías ni ubicaciones estáticas actuales. Las cuentas nuevas inician sin datos.
- Disponible en navegadores de escritorio, tablet, iPhone y Android mediante web responsive. Aplicaciones nativas y PWA no son requisitos del MVP.
- Diseñar para crecimiento gradual y costos bajos, **sin seleccionar aún lenguaje, framework de backend, base de datos, servicios de almacenamiento ni proveedor cloud**.
- Un límite económico de USD 10/mes es un **objetivo de planificación**, no una garantía de costo; se requiere validación temprana de precios y límites reales.

## 3. Personas y casos de uso

| Persona | Necesidad |
|---|---|
| Viajero individual | Registrar ciudades visitadas y fotos en su propio proyecto. |
| Familia o pareja | Mantener varios viajes bajo un proyecto compartido. |
| Invitado a un viaje | Aportar recuerdos solo a un viaje, sin ver los demás. |
| Propietario / administrador | Controlar participantes, contenido y permisos dentro de su ámbito. |

**Flujo principal:** iniciar sesión con Google → crear/abrir proyecto → crear/abrir viaje → registrar visita (país y ciudad; ubicación y fechas opcionales) → cargar fotos y descripciones → explorar mapa con filtros → invitar colaborador → colaborador añade fotografías autorizadas.

## 4. Modelo conceptual

`User` → `Project` → `Trip` → `Visit` → `Photo`.

- **Project:** espacio individual o colaborativo; contiene múltiples viajes y tiene un propietario principal.
- **Trip:** pertenece a un proyecto; nombre y descripción opcional; agrupa visitas.
- **Visit:** pertenece a un viaje; país y ciudad, lugar/coordenadas exactas opcionales; fecha única, intervalo completo o sin fecha. Una ciudad puede repetirse en viajes distintos o varias veces en el mismo.
- **Photo:** pertenece a una visita; autor, descripción opcional, original privado, versión(es) optimizada(s), estado de procesamiento y eliminación.
- **Membership / Invitation:** representan autorización por proyecto o por viaje; son conceptos de dominio, no tablas obligatorias.

Estos nombres son conceptuales y no fijan un esquema físico.

## 5. Requisitos funcionales y criterios de aceptación del MVP

### FR-01 — Identidad y perfil

- Inicio y registro mediante **Google Sign-In**; sin contraseñas locales en la beta.
- El usuario ve sus proyectos propios y aquellos a los que tiene acceso.
- **AC:** después de autenticarse, crear un proyecto y cerrar sesión, al volver a entrar el proyecto persiste; una persona no autenticada no puede consultar datos privados.

### FR-02 — Proyectos y viajes

- Crear y consultar proyectos; cada proyecto admite varios viajes.
- Crear viajes con nombre y descripción opcional. La facultad de crear viajes es **configurable por proyecto** con una regla simple: todos los miembros o solo administradores. Los invitados únicamente a viajes no crean otros viajes del proyecto.
- Un proyecto tiene **un propietario**, múltiples administradores posibles y transferencia de propiedad.
- **AC:** un mismo proyecto contiene al menos dos viajes independientes, y cambiar entre ellos no mezcla sus visitas; quien carezca del permiso para crear viajes recibe denegación también desde la API.

### FR-03 — Visitas, lugares y fechas

- Registrar **país y ciudad**, con ubicación exacta opcional y fecha opcional (sin fecha, día único o rango completo válido).
- Registrar varias visitas a la misma ciudad sin fusionar fotos entre ellas.
- **AC:** se pueden guardar dos visitas a Bogotá en el mismo viaje con fotos diferentes; una visita sin fechas aparece en la vista general; un rango con inicio posterior al fin se rechaza.

### FR-04 — Mapas y filtros

- Vista general **por proyecto**, que agrega únicamente viajes autorizados; posibilidad de abrir un viaje individual.
- Filtros por viaje, país e intervalo de fechas. El filtro temporal incluye visitas cuyo intervalo se superpone; las visitas sin fecha no aparecen cuando se activa un filtro de fechas.
- Mantener la experiencia cartográfica minimalista y adaptarla a ciudades y lugares específicos.
- **AC:** filtrar un proyecto por país o viaje muestra solo visitas coincidentes y autorizadas; un invitado de Italia no obtiene visitas ni fotos privadas de Colombia por interfaz ni API.

### FR-05 — Fotografías y descripciones

- Subida múltiple de **JPEG, PNG, WebP, HEIC/HEIF**, con progreso por archivo; máximo inicial **10 archivos por operación**.
- Tamaño máximo inicial **20 MB por archivo**; configurable. Descripción opcional por fotografía y por viaje.
- Conservar originales privados y generar versiones optimizadas para mapa/galerías; el original solo puede descargarse por su autor o administradores autorizados, sujeto a los permisos de acceso vigentes.
- Leer EXIF cuando esté disponible para **sugerir** fecha y ubicación; el usuario confirma o corrige antes de guardar. Nunca publicar GPS exacto sin consentimiento; retirar metadatos sensibles de las versiones de visualización.
- **AC:** una selección válida de hasta 10 imágenes aceptadas produce fotos consultables y originales protegidos; archivos inválidos o superiores al máximo se rechazan individualmente con causa; la propuesta EXIF se puede corregir o ignorar.

### FR-06 — Cargas parciales y consistencia

- Cada archivo tiene resultado independiente: cargado, procesando, fallido o rechazado.
- Conservar éxitos; permitir reintentar solo fallos sin duplicar la misma operación ni contabilizar dos veces almacenamiento. Una **nueva subida intencional** del mismo archivo es una operación distinta.
- No mostrar como disponible una foto sin sus recursos requeridos; limpiar recursos incompletos y liberar reservas fallidas de cuota.
- **AC:** ante 7 éxitos y 3 fallos de un lote de 10, permanecen los 7; reintentar los 3 no duplica los 7 ni altera incorrectamente la cuota.

### FR-07 — Colaboración y autorización

- Permisos a nivel **proyecto** y **viaje**. Los miembros de proyecto pueden ver y aportar a **todos** sus viajes. Un invitado a viaje solo puede ver/aportar en ese viaje.
- El usuario gestiona su contenido; administradores autorizados pueden gestionar el contenido ajeno **dentro de su ámbito**.
- Solo propietario o administradores autorizados generan invitaciones. En MVP: **enlaces privados** de un solo uso, con caducidad inicial de **7 días**, revocables y que exigen autenticación para aceptarse. El enlace otorga acceso al primer usuario autenticado que lo canjea; compartirlo implica ese riesgo.
- **AC:** usuario invitado solo a un viaje no puede listar otro, acceder a su API ni descargar sus archivos; una invitación caducada, revocada o ya usada no otorga acceso.

### FR-08 — Cuotas y límites

- Cuota inicial de **500 MB por usuario**, configurable; sin cuota por proyecto. Cuenta originales, derivados y archivos en papelera, **no respaldos internos**.
- La cuota corresponde al usuario que sube las fotos incluso al colaborar en proyectos ajenos. Si abandona un viaje, las fotos permanecen y siguen contando en su cuota mientras mantenga la cuenta.
- Al llegar al límite se rechazan **nuevas** cargas sin afectar fotos guardadas. Los límites se validan en servidor y deben permitir evolucionar por tipo de membresía, **sin planes de pago en MVP**.
- **AC:** una carga que exceda cuota se rechaza sin modificar fotos existentes; cargas concurrentes/reintentos no permiten superar la cuota por errores de contabilización.

### FR-09 — Papelera, archivado y eliminación segura

- Una foto eliminada desaparece de mapas y galerías; permanece recuperable **30 días**, sigue consumiendo cuota y después inicia borrado definitivo conforme a la política de respaldos.
- Autor o administrador autorizado puede restaurar fotos si el proyecto/visita y los permisos correspondientes siguen válidos.
- Proyectos y viajes permiten archivado sin pérdida de datos; las solicitudes de eliminación tienen **30 días de recuperación**. Antes del borrado definitivo de contenido colaborativo se avisa a los participantes y se les ofrece un procedimiento de conservación/descarga compatible con sus derechos.
- Para la beta, los casos complejos de eliminación/transferencia pueden resolverse mediante **procedimiento asistido y documentado**; no se exige todavía una interfaz administrativa completa.
- **AC:** una foto eliminada no es visible y se restaura dentro de plazo con datos conservados; una solicitud de purga de proyecto con aportes ajenos no destruye esos archivos sin ejecutar las salvaguardas establecidas.

### FR-10 — Salida, transferencia y eliminación de cuenta

- Al abandonar un proyecto/viaje, las fotos aportadas permanecen, con autoría; el exmiembro pierde el acceso que derivaba de su participación y puede solicitar la retirada posterior de sus aportes.
- Antes de eliminar su cuenta, el usuario elige explícitamente qué fotografías compartidas conservar y cuáles retirar; no se completa la operación sin esa elección. Para conservarlas, un responsable debe aceptar asumir el almacenamiento; de lo contrario se retiran. Las conservadas dejan de estar asociadas a la cuenta eliminada.
- Un propietario debe transferir la titularidad antes de abandonar un proyecto que continúe; no debe quedar un proyecto activo sin propietario válido.
- En la beta se admite atención asistida y segura de estas solicitudes; los flujos completos de autoservicio son posteriores.
- **AC:** la eliminación de cuenta no deja proyectos activos sin responsable ni fotos cargadas a una cuota inexistente; las fotos seleccionadas para retiro se despublican y procesan conforme a política; no se conserva atribución personal de una cuenta borrada.

## 6. Requisitos no funcionales (aprobados)

| ID | Requisito / verificación |
|---|---|
| NFR-01 Rendimiento | Objetivo: primera vista útil de mapa con **100 visitas en ≤4 s** bajo perfil de móvil/4G **documentado y reproducible**; ajustar solo tras medición. |
| NFR-02 Responsive | Flujos esenciales operables a **360, 768 y 1440 px**, sin desplazamiento horizontal involuntario. |
| NFR-03 Compatibilidad | Probar Safari en iPhone, Chrome en Android y navegadores modernos de escritorio. |
| NFR-04 Seguridad | Autenticación, autorización por recurso y descarga privada verificada **en backend**, no solo en frontend; conexiones protegidas y secretos fuera del cliente. |
| NFR-05 Integridad | Los reintentos no generan duplicados no intencionales ni inconsistencias de cuota, incluso con fallos o cargas concurrentes. |
| NFR-06 Privacidad | Derivados de visualización sin metadatos sensibles; originales privados; no exponer ubicación precisa sin aprobación. |
| NFR-07 Respaldo | Procedimiento documentado **y probado** de respaldo/restauración de metadatos y archivos; política de retención y límites de recuperación explícitos. |
| NFR-08 Observabilidad | Registrar errores, procesamiento de archivos y eventos de seguridad relevantes sin contraseñas, tokens, URLs privadas ni EXIF sensible en los logs. |
| NFR-09 Costos | Medir consumo de almacenamiento, procesamiento y tráfico; alertas/controles de gasto y límites de nuevas cargas. Objetivo económico inicial **USD 0–10/mes**. |
| NFR-10 Accesibilidad | Formularios y acciones principales utilizables con teclado y etiquetas accesibles; errores comprensibles. |

**Controles mínimos de seguridad adicionales:** validación de tipo real y tamaño de archivos, límites de frecuencia para intentos de invitación/carga, protección contra escalada de privilegios, y pruebas de acceso directo a identificadores/URLs privadas. Cualquier mecanismo temporal de acceso a archivos debe respetar las reglas de revocación y caducidad documentadas.

## 7. Fuera de alcance del MVP y roadmap

| Fase | Funciones |
|---|---|
| **MVP / beta privada** | FR-01 a FR-10 y NFR-01 a NFR-10, con procedimientos asistidos permitidos para casos administrativos complejos. |
| **v1.1 — Administración y experiencia** | Invitaciones enviadas por email, interfaz completa de gestión/transferencia/eliminación, mejoras de galerías y administración avanzada. |
| **v1.2 — Plataforma pública gratuita** | Registro abierto, enlaces públicos de solo lectura con revocación y controles de publicación, supervisión y políticas ajustadas a usuarios reales. |
| **v2.0 — Monetización** | Planes gratuitos/premium, cuotas por membresía, pagos, suscripciones y facturación tras validar demanda. |
| **Posterior** | Videos, rutas automáticas, exportación de álbumes, funcionalidades sociales y PWA si hay demanda. |

No se construirán para la beta: aplicación nativa, comentarios sociales, pagos, suscripciones, videos ni mapa global combinado de todos los proyectos personales.

## 8. Riesgos, validaciones y dependencias

1. **Repositorio actual:** auditar React/Leaflet, modelo estático, navegación y componentes antes de diseñar la integración. No se presupone que el frontend existente cubra ya las nuevas vistas.
2. **Procesamiento HEIC/HEIF y EXIF:** probar formatos reales de iPhone/Android, extracción controlada de GPS/fecha, generación de derivados y fallos de conversión bajo límites de costo.
3. **Costo de originales, derivados, papelera y respaldos:** estimar almacenamiento, egreso y procesamiento para 3–5 usuarios y crecimiento; ajustar despliegue y cuotas si el objetivo USD 0–10 resulta inviable.
4. **Colaboración y borrado:** verificar herencia de roles, revocación, salida, cuota del autor, eliminación de cuenta y proyectos con aportes de varias personas.
5. **Seguridad/legal:** revisar tratamiento de fotografías personales, retención, derechos de eliminación y términos apropiados antes del registro público.

La verificación de viabilidad **no autoriza quitar silenciosamente** HEIC/HEIF, EXIF u otra funcionalidad aprobada: cualquier cambio de alcance deberá ser aprobado y reflejado en una nueva versión del PRD.

## 9. Plan de entrega y definición de terminado

1. **Auditoría de frontend y contratos:** inventario real; flujos de interfaz a conservar; responsabilidades y contratos funcionales API (sin fijar stack).
2. **Identidad y núcleo:** usuarios, proyectos, viajes y visitas; persistencia y autorización básica.
3. **Mapa e integración:** consultas de proyecto/viaje, ubicaciones y filtros; estados vacíos y errores.
4. **Fotografías:** originales privados, derivados, EXIF, formatos, límites, cuotas, cargas parciales y reintentos.
5. **Colaboración:** invitaciones y roles de proyecto/viaje, protección de recursos.
6. **Protección y beta:** papelera, eliminación/transferencias asistidas, respaldos, pruebas de seguridad, rendimiento y costo; prueba con 3–5 usuarios.

**El MVP se considera listo cuando:** (a) el flujo principal funciona de extremo a extremo en móvil y escritorio; (b) los criterios de aceptación FR/NFR se han probado y los riesgos abiertos se documentan; (c) se demuestra aislamiento de permisos en API y archivos; (d) existen procesos verificables de respaldo, restauración y solicitud de eliminación; y (e) la operación inicial tiene monitoreo y controles de costo.

## 10. Decisiones diferidas a diseño técnico

- Backend (FastAPI frente a Node.js u otra alternativa), base de datos, procesador de imágenes, proveedor de identidad/almacenamiento, hosting y mecanismos de despliegue.
- Contratos de endpoints, esquema de persistencia, estrategia de tareas asíncronas, mecanismos de idempotencia, almacenamiento y revocación de enlaces.
- Configuración exacta del entorno de prueba de rendimiento, política técnica de respaldos/retención y mecanismo de recuperación operativa.

Estas decisiones se evaluarán **después** del PRD y de la auditoría del frontend, comparando sencillez operativa, seguridad, capacidad de crecimiento y costo.
