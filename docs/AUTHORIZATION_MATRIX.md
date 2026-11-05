# Travel Map — Matriz de autorización y permisos

**Versión:** 0.4 — P-03 y alcance E2.1/E2.2
**Fecha:** 2026-11-04
**Estado:** Borrador de diseño. La decisión #38 confirma restricciones del propietario; los restantes puntos abiertos siguen marcados como propuestas y **no** sustituyen las decisiones aprobadas en el PRD.  
**Fuentes:** `docs/PRD.md` v1.0 (FR-01, FR-02, FR-04 a FR-10; NFR-04 a NFR-06), `docs/DATA_MODEL.md` v0.1, auditoría de frontend de Codex y decisiones de colaboración #02, #03, #08, #15, #16, #26, #27, #35 y #36.  
**Alcance:** autorización conceptual para la beta privada, sin fijar API, mecanismo de sesión, framework o esquema de base de datos.

**Decisión #38 (aprobada por el usuario):** solo el propietario puede nombrar o retirar administradores y archivar el proyecto; los administradores pueden gestionar miembros, viajes y fotografías dentro de su ámbito. El permiso de restaurar un proyecto y quién cambia la configuración ordinaria permanecen pendientes de confirmación.

## 1. Principios y vocabulario

- **Denegar por defecto:** ninguna identidad adquiere acceso a datos privados simplemente por estar autenticada, conocer un identificador, compartir una ciudad o poseer un enlace no canjeado.
- **Servidor como autoridad:** el backend verifica todos los accesos a recursos, agregados, miniaturas, originales y operaciones. Las opciones visibles en React son indicadores de UX, no autorización.
- **Menor privilegio y ámbito explícito:** ser miembro de un proyecto da acceso a **todos sus viajes**; ser invitado solo a un viaje **no** da acceso al proyecto completo ni a otros viajes.
- **Autoría ≠ membresía ≠ responsabilidad de cuota:** conservar la autoría de una foto o pagar por su almacenamiento no autoriza a consultar un viaje del que se ha salido.
- **Estados y permisos se combinan:** un actor con rol suficiente puede verse impedido de editar por eliminación pendiente, revocación, falta de cuota, una invitación inválida u otras reglas de integridad.
- **Geografía ≠ permiso:** `Place` es una referencia geográfica; la vista transversal futura solo puede agregar `Visit` y `Photo` ya autorizadas.
- **No se definen superusuarios de plataforma:** un operador que atienda solicitudes asistidas necesitará controles operativos y auditoría específicos; no es un rol de usuario normal de esta matriz.

### Actores

| Clave | Actor | Alcance efectivo |
|---|---|---|
| **O** | Propietario del proyecto | Titular único; controla propiedad y administración del proyecto y sus viajes. |
| **A** | Administrador del proyecto | Administra recursos y participantes dentro del proyecto, sin transferir propiedad ni eliminar al propietario. |
| **M** | Miembro común del proyecto | Puede ver y aportar a **todos** los viajes; crear viajes solo si la política del proyecto lo permite. |
| **G** | Invitado exclusivamente a un viaje | Puede ver y aportar **solo** en el viaje explícitamente autorizado. |
| **X** | Autenticado sin membresía efectiva | Sin acceso a los datos privados del proyecto/viaje. |
| **Ø** | No autenticado | Sin acceso a datos privados; puede iniciar el flujo de login y recibir una invitación sin canjearla. |

Un usuario puede tener varias relaciones, incluso G para un viaje y M para su proyecto. **Si existe membresía activa de proyecto, se aplica su acceso heredado**; la invitación al viaje no lo restringe ni otorga permisos por encima del rol de proyecto. Para el MVP **no** se introduce un rol administrativo independiente de viaje ni restricciones por viaje que contradigan la herencia aprobada. Si se requiere otro nivel en el futuro, exigirá revisión de permisos y PRD.

**Leyenda:** **Sí** = permitido si el recurso está en estado apto; **No** = prohibido; **Cond.** = permitido solo con la condición indicada. Las acciones de administración no equivalen a autorización para leer datos fuera del ámbito.

## 2. Matriz de proyecto

| Acción sobre `Project` | O | A | M | G | X / Ø | Regla adicional |
|---|:---:|:---:|:---:|:---:|:---:|---|
| Crear un proyecto nuevo | Sí | Sí | Sí | Sí | X: Sí / Ø: No | Cualquier cuenta autenticada puede crear su propio proyecto; la columna indica capacidad global, no sobre el proyecto ajeno. |
| Ver proyecto y sus viajes en mapa general | Sí | Sí | Sí | No | No | G puede acceder a su viaje, **no** a la vista general ni a conteos de otros viajes. |
| Editar nombre/configuración ordinaria | Sí | Sí | No | No | No | Configuración incluida: quién puede crear viajes. **Propuesta**: A puede cambiarla. |
| Nombrar o revocar administradores | Sí | No | No | No | No | **Confirmado en decisión #38**; no hay delegación de este permiso. |
| Invitar miembros comunes al proyecto | Sí | Sí | No | No | No | Invitación autenticada de un solo uso, revocable y con vencimiento. |
| Retirar a un miembro común | Sí | Sí | No | No | No | No elimina automáticamente sus fotos; su cuota continúa. |
| Retirar a otro administrador | Sí | No | No | No | No | **Confirmado en decisión #38**: reservado al propietario. |
| Transferir propiedad | Sí | No | No | No | No | Requiere destinatario válido y aceptación; propuesta de flujo. |
| Archivar proyecto | Sí | No | No | No | No | **Confirmado en decisión #38**: reservado al propietario. |
| Restaurar proyecto archivado | Cond. | No | No | No | No | **Propuesta pendiente**: solo propietario, sujeto al estado del proyecto. |
| Solicitar eliminación del proyecto | Sí | No | No | No | No | Recuperación de 30 días, aviso y salvaguardas sobre fotos de terceros. |
| Abandonar proyecto por voluntad propia | Cond. | Sí | Sí | N/A | No | O debe transferir propiedad antes, si el proyecto sigue activo. Retirar acceso no transfiere cuotas automáticamente. |

**Observación de modelado:** el propietario se deriva de `Project.ownerUserId`; no se duplica como rol editable de `ProjectMembership`.

## 3. Matriz de viaje

Todas las celdas siguientes se refieren a **un `Trip` determinado**. Para G, ese viaje debe ser el que figura en su `TripMembership` activo.

| Acción sobre `Trip` | O | A | M | G | X / Ø | Regla adicional |
|---|:---:|:---:|:---:|:---:|:---:|---|
| Listar / abrir / consultar viaje | Sí | Sí | Sí | Sí | No | No devuelve otros viajes ni datos privados del proyecto a G. |
| Crear viaje en proyecto | Sí | Sí | Cond. | No | No | M solo cuando `Project` permite crear viajes a todos los miembros. |
| Editar título y descripción del viaje | Sí | Sí | No | No | No | **P-03 aprobada, opción A (2026-11-04)**: solo O/A; la autoría de M no concede edición. |
| Invitar colaboradores solo a este viaje | Sí | Sí | No | No | No | No permite usar la invitación para entrar al proyecto completo. |
| Retirar invitado de este viaje | Sí | Sí | No | No | No | Invalida futuras lecturas privadas; preserva fotos y cuotas según política. |
| Archivar / restaurar viaje | Sí | Sí | No | No | No | **Propuesta**, sujeto a reglas de estado del proyecto. |
| Solicitar eliminación de viaje | Sí | Sí | No | No | No | Recuperación 30 días y protección de contribuciones ajenas. |
| Abandonar el viaje | N/A | N/A | N/A | Sí | No | M hereda acceso del proyecto: para salir del viaje tendría que salir del proyecto. |

Las modificaciones o eliminaciones de viajes no deben permitir eludir la protección de fotografías de otros autores. Los procedimientos asistidos del MVP siguen las mismas restricciones.

## 4. Matriz de visitas

Las visitas son compartidas. `Visit.createdByUserId` registra a su creador, pero **no** concede acceso independiente si deja de pertenecer al proyecto o viaje.

| Acción sobre `Visit` | O | A | M | G | X / Ø | Regla adicional |
|---|:---:|:---:|:---:|:---:|:---:|---|
| Listar / leer visita y ubicación permitida | Sí | Sí | Sí | Sí | No | Solo en viaje accesible y recurso visible. |
| Crear visita | Sí | Sí | Sí | Sí | No | G únicamente en su viaje autorizado; país y ciudad requeridos. |
| Editar lugar, fechas, descripción de visita si existiera | Sí | Sí | Cond. | Cond. | No | M/G solo cuando son **creadores de esa visita** y conservan acceso. |
| Solicitar eliminación de visita | Sí | Sí | Cond. | Cond. | No | Misma condición del creador; se aplican salvaguardas de fotos ajenas. |
| Restaurar visita | Sí | Sí | Cond. | Cond. | No | **Propuesta**: creador con acceso vigente; padres vigentes y dentro de plazo. |

**Propuesta de ciclo de vida:** una visita eliminada se oculta, sus fotos dejan de mostrarse normalmente y existe un período de 30 días de recuperación; el plazo de 30 días para `Visit` es una extensión propuesta del modelo, no una regla explícita del PRD v1.0 para visitas. No se purgan aportes ajenos hasta resolver aviso, recuperación y sus derechos.

## 5. Matriz de fotografías y medios

En esta tabla, **«autor» significa `Photo.authorUserId` de cuenta activa con acceso vigente al viaje**; no equivale a «responsable de cuota». O/A administran fotos ajenas dentro de su proyecto. M/G solo gestionan sus propias fotos mientras tienen acceso.

| Acción sobre `Photo` / `PhotoAsset` | O | A | M | G | X / Ø | Regla adicional |
|---|:---:|:---:|:---:|:---:|:---:|---|
| Ver foto y derivados optimizados | Sí | Sí | Sí | Sí | No | Fotos disponibles, ancestros visibles y scope autorizado. |
| Subir fotos a una visita autorizada | Sí | Sí | Sí | Sí | No | Cuota propia, formato/tamaño válidos y máximo por operación. |
| Editar descripción de una foto | Sí | Sí | Cond. | Cond. | No | M/G solo si son autor; requiere acceso vigente. |
| Mover foto a otra visita | Por definir | Por definir | Por definir | Por definir | No | **Fuera del MVP por defecto** hasta aclarar consentimiento de autoría/cuotas y permisos de ambos destinos. |
| Enviar foto a papelera | Sí | Sí | Cond. | Cond. | No | M/G solo si son autor; papelera 30 días y cuota vigente. |
| Restaurar foto desde papelera | Sí | Sí | Cond. | Cond. | No | M/G solo si son autor; exige acceso y ancestros restaurables/vigentes. |
| Descargar **original** privado | Sí | Sí | Cond. | Cond. | No | M/G solo si son autor; O/A dentro de su ámbito, como establece FR-05. |
| Ver EXIF sensible o GPS no publicado | Cond. | Cond. | Cond. | Cond. | No | **Decisión pendiente:** no equivale a permisos de mostrar ubicación precisa en el mapa; los originales pueden contener EXIF. Se necesita política explícita para su exposición. |
| Solicitar retirada de aportes tras salir | Cond. | Cond. | Cond. | Cond. | No | Es un **derecho del antiguo autor con identidad verificada** y procedimiento asistido; no se reabre acceso al viaje. No debe modelarse como lectura normal. |

**Nota de acceso al original:** el PRD permite descargarlo a autor y administradores autorizados. Esto podría exponer metadatos EXIF contenidos en el original a dichos administradores. Antes de desarrollar la interfaz, hay que explicitar ese efecto en privacidad/consentimiento. Nunca se devolverán URLs públicas permanentes de originales o derivados privados.

## 6. Invitaciones: autorización y ciclo de vida

| Operación / estado | Regla aprobada o propuesta |
|---|---|
| Emitir invitación a proyecto o viaje | Solo O/A del proyecto, en el ámbito autorizado. |
| Alcance | Exactamente un proyecto **o** un viaje; no ambos. |
| Destinatario | El enlace del MVP no está necesariamente ligado a email; el primer usuario autenticado que lo canjee correctamente recibe el acceso. |
| Canjear | Un usuario autenticado con invitación vigente, no revocada y no usada; comprobación y consumo **atómicos** para impedir doble uso. |
| Caducidad | Siete días desde emisión (valor inicial configurable). |
| Revocar | O/A del proyecto antes de consumir; revocación impide nuevos canjes. |
| Resultado proyecto | Crear membresía común de proyecto; **propuesta:** no elevar a administrador por enlace compartible. |
| Resultado viaje | Crear acceso colaborador solo al viaje identificado; sin acceso a lista de otros viajes. |
| Usuario ya miembro | **Propuesta:** no crear membresías duplicadas ni degradar un rol existente; mostrar resultado idempotente sin ampliar acceso. |
| Se retira participante después del canje | Se revoca su membresía, no solo el enlace original; los archivos dejan de ser accesibles en nuevas solicitudes autorizadas. |

Una invitación **no concede lectura de contenido privado antes del canje**. Su previsualización, si existiera, mostraría solo información mínima no sensible. Nunca registrar ni filtrar el secreto del enlace en logs o analítica.

## 7. Evaluación de permisos y precedencia

Para cualquier recurso privado, seguir este orden conceptual:

1. **Identidad:** ¿hay sesión válida y cuenta activa? En caso contrario, denegar; el canje de invitación lleva a autenticación, no expone el recurso.
2. **Estado de acceso:** ¿existe propietario, membresía de proyecto activa o membresía del viaje activo? Resolver acceso heredado de proyecto o explícito de viaje.
3. **Ámbito y jerarquía:** verificar que `Trip.projectId`, `Visit.tripId` y `Photo.visitId` conducen al recurso autorizado. **Nunca** usar un ID de objeto aislado como prueba de acceso.
4. **Acción:** verificar rol (O/A/M/G), condición de creador o autor y política de creación de viajes.
5. **Estado de recursos:** verificar activo/archivado/en papelera/pendiente de eliminación y permisos especiales de gestión/restauración.
6. **Reglas operativas:** validar límites, cuota, tamaño/tipo de archivos, caducidad/revocación, consentimiento de ubicación exacta y salvaguardas del contenido colaborativo.
7. **Resultado:** entregar solo campos, conteos, ubicaciones, variantes y URLs que esa operación permite consultar; registrar un evento de seguridad sin incluir datos sensibles.

**Desempates:** permisos efectivos de proyecto prevalecen sobre membresía de viaje; las reglas de propiedad y autoría dan capacidad de gestión **solo** dentro de un ámbito actualmente autorizado; una invitación pendiente no incrementa permisos. No existen *deny overrides* configurables por viaje en el MVP.

Los códigos concretos HTTP (401/403/404), el transporte de sesión, la estrategia de cache de archivos y expiración de URLs se definirán en el contrato de API y arquitectura. Las respuestas de error no deben revelar existencia o metadatos de recursos de otro ámbito.

## 8. Vista geográfica y agregación segura

| Vista | Permiso efectivo | Datos que puede incluir |
|---|---|---|
| Mapa general de proyecto (MVP) | O/A/M del proyecto | Solo viajes/visitas/fotos de ese proyecto en estado visible. |
| Viaje individual (MVP) | O/A/M heredados, o G de ese viaje | Solo visitas y fotos del viaje; contexto mínimo de proyecto sin lista de otros viajes. |
| Explorador global por país/ciudad (futuro) | Unión de scopes existentes | Fotos de múltiples proyectos/viajes **autorizados**, sin duplicados por IDs. |
| Lugar geográfico (`Place`) | Catálogo geográfico público o independiente | Referencia geográfica únicamente; no autoriza acceder a recuerdos asociados. |

**Protección de agregados:** resolver autorización **antes** de filtrar, paginar, contar, calcular facetas/estadísticas o devolver miniaturas. Ninguna lista de países visitados, número de fotos, etiquetas de ubicación o fechas puede revelar contenido de viajes ajenos.

Una misma fotografía puede aparecer en varias vistas, pero su identidad y cuota se contabilizan una sola vez. Revocar membresías requiere invalidar o dejar caducar los mecanismos de acceso a medios; no puede borrar archivos que un usuario ya descargó. Las caches privadas de interfaz se limpian cuando se cierra sesión o se pierde el acceso conocido.

## 9. Estado, archivado, eliminación, transferencia

- **Archivar proyecto/viaje:** se oculta de vistas normales, no elimina fotos ni libera cuota; las herramientas de administración/restauración operan con permisos especiales y estados explícitos.
- **Papelera de foto:** oculta el contenido de la galería durante 30 días; sigue contando cuota. Restauración exige autor o administrador habilitado y padres restaurables.
- **Eliminación de proyecto/viaje:** 30 días de recuperación; antes de purga definitiva, notificar y ofrecer procedimiento de conservación/descarga de aportes de colaboradores. No purgar automáticamente fotos ajenas sin salvaguardas.
- **Salida de miembro:** se revoca acceso pero fotos anteriores permanecen, atribuidas y a su cuota. Solicitudes posteriores de retirada se gestionan con identidad verificada, sin reabrir viajes privados.
- **Eliminación de cuenta:** elección explícita de fotos a conservar/retirar; para conservar, nuevo responsable acepta cuota suficiente y se desvincula identidad personal antes de completar la eliminación. Proyectos activos deben conservar titular válido; transferencia de propiedad previa.
- **Operaciones asistidas:** el MVP puede usar procedimientos administrativos documentados y auditados en lugar de autoservicio completo, pero no puede omitir las reglas anteriores.

**Propuesta de separación:** quien autoriza una solicitud de borrado no necesariamente tiene derecho a ejecutar sin salvaguardas la purga física irreversible; las operaciones de purga/backup son procedimientos operativos auditables.

## 10. Escenarios de prueba de autorización

| ID | Dado / cuando | Entonces (resultado verificable) |
|---|---|---|
| AM-01 | Ø o X solicita fotos de un viaje privado | No recibe imágenes, metadatos, conteos ni pistas de existencia. |
| AM-02 | G tiene acceso a Italia, pero solicita Colombia usando un ID conocido | Se rechaza sin datos de Colombia; tampoco aparece en el mapa ni sus conteos. |
| AM-03 | M participa en proyecto con dos viajes | Puede consultar ambos y aportar fotografías; no necesita membresía de cada viaje. |
| AM-04 | M intenta crear viaje cuando el proyecto restringe creación a administradores | El backend rechaza la creación; si se habilita para miembros, la acepta. |
| AM-05 | G crea visita y M (no creador) intenta cambiar sus fechas | La creación es válida; la edición de M se rechaza. O/A sí pueden editar. |
| AM-06 | M/G autor intenta eliminar su propia foto y otra foto ajena | La primera va a papelera; la segunda se rechaza. |
| AM-07 | A intenta transferir propiedad o concederse propiedad | Se rechaza. Solo O puede iniciar transferencia permitida. |
| AM-08 | Dos usuarios canjean a la vez el mismo enlace válido | Como máximo uno recibe nueva membresía; el otro obtiene resultado de invitación consumida. |
| AM-09 | Se revoca una membresía mientras la galería está abierta | Las solicitudes siguientes a API/medios se deniegan; el cliente limpia estado sensible y cierra visor. |
| AM-10 | Autor abandona proyecto y solicita retirar una foto que aportó | Puede iniciar solicitud autenticada/asistida sin recuperar lectura de otras fotos o visitas. |
| AM-11 | O/A descarga original de foto ajena dentro de su proyecto | Permitido según PRD; su alcance se verifica y la acción queda sujeta a política de metadatos y registro seguro. |
| AM-12 | G ejecuta futura búsqueda de Colombia entre proyectos | Solo ve sus viajes autorizados; países y conteos ajenos no se filtran como pistas. |
| AM-13 | Se intenta restaurar foto, pero visita/proyecto padre está pendiente de purga o ya no es accesible | No se restaura en un ámbito inválido; se informa opción de recuperación asistida si corresponde. |
| AM-14 | Cuenta se elimina y quedan fotos compartidas seleccionadas para conservación | Solo se conservan tras aceptación de responsable con cuota; sin identidad personal residual ni cuota huérfana. |
| AM-15 | Usuario conoce una URL de derivado tras salir del viaje | El control de acceso/revocación impide **nuevas entregas** según el mecanismo elegido; no se promete revocar copias ya descargadas. |

## 11. Decisiones abiertas antes de la implementación

No alterar silenciosamente el PRD para resolver las siguientes cuestiones:

| ID | Decisión por confirmar | Propuesta conservadora |
|---|---|---|
| **P-01a — Resuelta (#38)** | ¿Quién puede archivar un proyecto? | Solo O. A no puede. |
| **P-01b — Pendiente** | ¿Quién puede restaurar un proyecto archivado? | Solo O en MVP (propuesta por confirmar). |
| **P-02a — Resuelta (#38)** | ¿Quién puede promover/revocar administradores? | Solo O. |
| **P-02b — Pendiente** | ¿Quién puede editar configuraciones ordinarias del proyecto? | O y A, salvo ajustes sensibles (propuesta por confirmar). |
| **P-03 — APROBADA** | ¿Puede el creador de un `Trip` (M) editarlo si no es A? | Opción A, aprobada el 2026-11-04: no; solo O/A. Implementada en E2.1. No cambia las reglas de creador/Admin de Visit (E2.2). |
| **P-04** | ¿Plazo de recuperación de `Visit`? | 30 días, consistente con otras entidades, pendiente de aprobación explícita. |
| **P-05** | ¿Cómo gestionar EXIF del original descargado por administradores? | Avisar al autor y documentar que los originales pueden conservar EXIF; no mostrar GPS preciso en UI sin consentimiento. |
| **P-06** | ¿Cómo se tramita la transferencia de propiedad? | Destinatario con cuenta válida, aceptación explícita, operación auditable. |
| **P-07** | ¿Puede un usuario mover fotos entre visitas? | No en MVP; reevaluar consentimiento y permisos de ambos destinos. |
| **P-08** | ¿Cómo gestionamos invitaciones canjeadas por un usuario ya miembro? | Evitar duplicados y no elevar privilegios; informar el acceso existente. |
| **P-09** | ¿Qué información mínima del proyecto puede ver G? | Título/contexto indispensable del viaje, sin listar otros viajes, miembros o estadísticas privadas. |
| **P-10** | ¿Puede G consultar lista completa de participantes del viaje? | Solo nombres/autores necesarios para la colaboración; sin emails ni datos de proyectos ajenos. |

**Punto de control antes de implementar:** confirmar los apartados pendientes (P-01b, P-02b y P-04 a P-10) o etiquetarlos formalmente como decisiones diferidas con un comportamiento por defecto aprobado. Después, derivar pruebas de autorización por recurso, por ruta de navegación y por acceso a medios. No seleccionar ni implementar un mecanismo de seguridad específico todavía.

## 12. Relación con documentos siguientes

- `docs/DATA_MODEL.md`: ámbitos, autoría, responsables de cuota y relaciones entre recursos.
- `docs/ARCHITECTURE.md`: implementación de identidad/sesión, mecanismos de autorización, medios privados, purga y revocación.
- `docs/API_CONTRACT.md`: requisitos de cada operación, validación de scopes, errores sin filtraciones y respuestas mínimas.
- `docs/IMPLEMENTATION_PLAN.md`: tareas y pruebas de seguridad/aislamiento antes de la beta.

**Advertencia de alcance:** la vista transversal de fotografías por país/ciudad se prepara conceptualmente, pero no es una interfaz ni un endpoint requerido para el MVP. No representa acceso público a recuerdos de otros usuarios.

## Alcance implementado E2.1 (2026-11-04)

Solo las cuatro rutas de viajes descritas en [API_CONTRACT](API_CONTRACT.md#e21-implemented-trip-contract-2026-11-04) están implementadas. O/A/M pueden listar los viajes de su proyecto; G solo puede abrir su viaje explícito, nunca enumerar el proyecto. O/A crean; M crea únicamente con `all_project_members`; solo O/A editan nombre/descripción. Se requiere cuenta, sesión, proyecto y relación efectivos activos. Una relación G revocada no niega acceso heredado activo. La creación/revocación de membresías e invitaciones sigue diferida. Evidencia: [E2.1](../backend/E2_1_VALIDATION.md).

## Alcance implementado E2.2 (2026-11-04)

D1/D2/D3 aprobadas. El catálogo es independiente/controlado y requiere sesión activa; nunca recibe sugerencias o conteos de visitas privadas. Una visita exige acceso activo a Trip y Project por herencia O/A/M o invitación Guest explícita al viaje. O/A/M/G pueden crear y leer. Solo el creador con acceso vigente u O/A del Project pueden editar; otros M/G reciben 403 sobre una visita visible. El creador revocado recibe 404; su aporte permanece almacenado.

| Operación implementada | O | A | M | G |
|---|---|---|---|---|
| Buscar Places (catálogo independiente) | Sí | Sí | Sí | Sí |
| Listar/crear/leer Visits del Trip accesible | Sí | Sí | Sí | Solo su Trip |
| Editar Visit ajena dentro del ámbito | Sí | Sí | No | No |
| Editar Visit propia con acceso vigente | Sí | Sí | Sí | Solo su Trip |
| Mapa de Project, con filtros acotados | Sí | Sí | Sí | No |
| Mapa del Trip accesible | Sí | Sí | Sí | Solo su Trip |
| Guardar o publicar coordenadas exactas de Visit | No | No | No | No; política pendiente |

Las proyecciones Guest no incluyen nombre/roster/email del Project, otros viajes ni agregados globales. Solo identificadores de Visit/Trip, autor de Visit cuando corresponde al DTO de visita, catálogo independiente, fechas y cero/null de fotos futuras. La ausencia de un proyecto/viaje/visita, inaccesibilidad o estado inactivo produce 404; no se usa similitud geográfica como permiso. Todas las consultas filtran antes de paginar/proyectar; no hay conteos/facetas sin ámbito.

Confirmación y visibilidad de puntos exactos quedan pendientes: no se infiere consentimiento de sesión, rol o autoría. Se rechazan escrituras de puntos y se devuelve confirmedCoordinates=null, también para Owner/Admin. Visibilidad más amplia del Project/participantes (P-09/P-10), eliminación/restauración (P-04), miembros/invitaciones y medios siguen diferidos. Evidencia: [E2.2](../backend/E2_2_VALIDATION.md).
