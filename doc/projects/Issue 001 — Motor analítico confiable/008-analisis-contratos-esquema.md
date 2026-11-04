# Issue 001 — Etapa 3: contratos estructurales y evolución

Fecha: 2026-11-04. Propuesta pendiente de aprobación; sin implementación.

## 1. Alcance y conclusión

Se verificó la rama `issue-motor-analitico-confiable` y Git limpio al inicio. Solo se agrega este documento. No se modificaron código, pruebas, configuración, credenciales ni datos. No se realizaron solicitudes a SAP: la evidencia de metadata del documento 006 se trata como antecedente histórico, no como consulta renovada.

Recomiendo validar estructura **antes de construir objetos CSV y antes de publicar snapshots**, usando un contrato pequeño por fuente y requisitos por operación. Separar tres conceptos: versión del contrato aprobado, esquema observado y versión del snapshot. Un hash distinto no implica incompatibilidad. Las columnas adicionales o reordenadas deben aceptarse si no alteran campos requeridos, perfiles o semántica.

La validación de transporte y números ya existe; no sustituye la validación estructural. Un entero bien formado en una columna equivocada sigue produciendo un cálculo incorrecto. El sistema propuesto conserva los contratos numéricos y evita convertir errores estructurales en conjuntos vacíos, ceros o rankings exitosos.

## 2. Diagnóstico sustentado

### Defectos confirmados con ejecuciones sintéticas

Se invocó CsvProvider con buffers sintéticos interceptados solo en memoria, restaurando fs después de cada caso. Ejemplos y nombres de entidades de esta sección son inventados.

| Caso ejecutado | Resultado actual |
| --- | --- |
| Encabezado `MATERIAL1,ID_CENTRO,SUMA_NETA`; fila `TEST,A,10,999` | Descarta el cuarto campo y devuelve SUMA_NETA=10 sin error. |
| Mismo encabezado; fila `TEST,10` | Asigna 10 a ID_CENTRO y omite SUMA_NETA. No detecta si falta un campo intermedio o final. |
| `MATERIAL1,SUMA_NETA,SUMA_NETA`; fila `TEST,10,999` | Conserva solo la última SUMA_NETA, 999. |
| `MATERIAL1,ID CENTRO,ID_CENTRO,SUMA_NETA` | La normalización colisiona; la segunda columna de centro sobrescribe la primera. |
| `snapshot.slice()` de CSV registrado | `numeric.isStrict(copia)` devuelve false: pierde procedencia/perfil. |
| ODataTransport con Content-Type negociado y `value:[{}]` | Acepta un registro vacío. Eso es válido como prueba de transporte, pero insuficiente para una consulta que requiere propiedades. |

La documentación de csv-parse confirma que, con `columns` y `relax_column_count`, se omiten campos o columnas sin correspondencia. No realinea por significado: asigna por posición. [csv-parse, relax_column_count](https://csv.js.org/parse/options/relax_column_count/).

### Evidencia estructural del CSV local

Se examinaron los registros completos como arrays, sin imprimir celdas ni valores de negocio:

- Encabezado principal: nueve posiciones. Fila superior: nueve posiciones.
- Todos los registros de datos examinados: nueve campos.
- El encabezado principal tiene huecos en índices 2 y 8 (base cero); el provider recupera SUMA_NETA desde la fila superior en el último.
- Ninguna posición está vacía en todos los registros. En particular, la columna anónima que se publica como COL_2 **no puede descartarse como relleno vacío**.

Esta evidencia permite exigir ancho exacto en este archivo sin cambiar sus datos. No prueba que futuras exportaciones tengan igual formato ni certifica el significado de la columna anónima. Tampoco detecta intercambios de valores entre campos si mantienen ancho y tipos compatibles.

### Puntos de entrada y validación insuficiente

| Componente y referencia | Situación actual |
| --- | --- |
| `CsvProvider.js:20–33` | Busca MATERIAL1 como substring de una línea física, no como celda exacta de un registro CSV. Puede confundir preámbulos o contenido; no valida un conjunto de encabezados. |
| `CsvProvider.js:37–65` | Fusiona dos filas por huecos, recorriendo solo el ancho de la inferior. No detecta encabezados superiores sobrantes, conflictos o colisiones normalizadas. |
| `CsvProvider.js:73–101` | Ambas rutas toleran cantidad variable. La ruta con columnas iniciales vacías recorta registros antes de mapear, sin comprobar que los campos descartados estén realmente vacíos. |
| `helpers.js:1–8` | Normaliza signos/espacios y genera COL_n. No comprueba unicidad ni colisión entre un nombre explícito y uno generado. |
| `ODataProvider.js:16–27` | Normaliza propiedades a nombres locales y puede sobrescribir colisiones. No consulta metadata. |
| `ODataTransport.js:read/register` | Comprueba MIME, versión si está presente, envelope V4 y representación SUMA_NETA/count. No liga el payload a EntityType, proyección o contrato de campos. El perfil Int64 está fijado por el descubrimiento anterior. |
| `DataService.js:144–162` | Antes de publicar comprueba array de objetos, no nombres ni tipos estructurales. Invalida derivados después de cargar, conservando el snapshot anterior ante excepción. Es el lugar apropiado para una última barrera estructural. |
| `QueryService.js:14–27` y `DatasetProfileService.js:23,76` | Derivados ligados a identidad de filas; coherencia de datos resuelta en Etapa 1. No conocen versión de contrato. |
| `CacheService.js:11–32` | Map con valor y vencimiento, sin esquema. No hace falta convertirlo en un gestor genérico de contratos. Al vencer elimina la entrada: conservar memoria para auditoría no implica servirla como vigente. |
| `numeric.js:3–13,58` | WeakMaps por array. Sin información de columnas, proyección o linaje; arrays no registrados usan conversión legada. |
| `DataService.getInsights`, `fetchMovMat` y consultas filtradas | Caminos que no pasan todos por publicación en MOVMAT_DATA; validarlos solo en _loadAndPublish dejaría rutas sin protección. |
| `ExportService.js:152` y fallback de DataService | Exportación crea job y descarga bytes con contrato no verificado. Se registra EXPORT sin perfil numérico. Los conteos todavía requieren estructura válida aunque no requieran métrica. |

### Consumidores y columnas

`QueryEngineService.js:63–66` usa nombres parciales y, para fecha/centro, posiciones 0/1 como último recurso. `IndexService.js:21–24`, `DatasetProfileService.js:32` e `InsightEngineService._detectCols:561` usan coincidencias parciales. `SummaryService.js:25` encuentra nombres que incluyen SUMA_NETA. Una columna adicional podría cambiar la selección heurística aunque el conjunto anterior permanezca intacto.

Propuesta de requisitos por capacidad:

| Capacidad | Propiedades necesarias |
| --- | --- |
| Conteo de filas sin filtros | Estructura de registros válida; ninguna métrica. |
| Movimientos por fecha / perfil temporal | FECHA. |
| Centros por fecha/rango | FECHA, ID_CENTRO. |
| Suma por grupo/fecha | FECHA, ID_CENTRO, GRUPO_ARTICULOS, SUMA_NETA o alias CSV explícito aprobado. |
| Comparación de suma mensual | FECHA y SUMA_NETA. |
| Actividad por clase | FECHA, ID_CENTRO, CLASE_MOVIMIENTO. |
| Diferencias de materiales | FECHA, MATERIAL1; alias solo si está declarado. |
| Presentación | NOMBRE_CENTRO opcional; ausencia no impide cálculos que no lo usan. |
| Comparación entre unidades | UNIDAD o anotación equivalente si el contrato de dominio la exige; hoy esa semántica no está certificada. |

Para el snapshot CSV completo MovMat, recomiendo requerir el conjunto de seis campos funcionales: MATERIAL1, FECHA, ID_CENTRO, GRUPO_ARTICULOS, CLASE_MOVIMIENTO y SUMA_NETA (o alias autorizado). No exigir NOMBRE_CENTRO, UNIDAD ni COL_2 para publicar por defecto; mantenerlos si aparecen. Esta elección de obligatoriedad requiere aprobación: como alternativa pueden habilitarse capacidades por subconjunto, pero nunca devolver éxito de una capacidad cuyos campos faltan.

Para OData filtrado se valida la proyección solicitada, no se exigen todas las columnas del dataset completo. `DatasphereQueryBuilder.js:50–77` ya selecciona distintos conjuntos. Un count con `$top=0` puede devolver `value:[]`; no debe fallar por no tener SUMA_NETA. Un payload vacío conserva el esquema/proyección desde metadata, no lo infiere de rows[0]. Los tipos EDM de dimensiones quedan por verificar; no se inventan como String/Date por sus nombres.

## 3. Contrato CSV recomendado

1. Leer registros CSV con csv-parse como arrays antes de convertirlos a objetos. Reconocer encabezado mediante celdas exactas y combinación esperada; no por substring. Preservar registros multilínea correctamente entrecomillados.
2. Separar preámbulo, encabezado simple y doble según reglas declaradas. Una fase de reconocimiento puede tolerar distintos anchos del preámbulo; esa tolerancia termina antes de aceptar datos. Si se usa `relax_column_count:true` en esa fase, validar explícitamente cada ancho antes de mapear, nunca confiar en `columns:true` tolerante.
3. En doble encabezado, exigir anchos iguales y rellenar solo huecos permitidos. Las etiquetas superiores meramente decorativas no renombran campos inferiores. Campos superiores desconocidos o conflictos no previstos provocan error, no fusión especulativa.
4. Validar unicidad de encabezados finales antes y después de normalizar, incluyendo colisiones con COL_n. Rechazar duplicados incluso si las celdas del ejemplo coinciden: no hay regla segura para elegir uno.
5. Cada registro de datos debe tener exactamente el ancho declarado, antes de recortar columnas. No rellenar ni truncar automáticamente; no saltar filas corruptas.
6. Columnas iniciales declaradas como relleno solo pueden eliminarse si cada registro tiene esas posiciones vacías. Un hueco interior con datos se conserva como columna opaca, con procedencia de su posición. Para el CSV actual, preservar COL_2; no asociarlo a una métrica.
7. Mapear columnas nombradas por identidad normalizada, no por orden. Un alias se declara una sola vez en el contrato y debe resolver sin ambigüedad. COL_8 no se considera SUMA_NETA solo porque caiga en posición 8: conservar el alias histórico únicamente en el layout que lo declare expresamente.
8. Columnas adicionales únicas se conservan y no se vuelven candidatas automáticas de métricas. Resolver consumidores mediante mapa de roles validado elimina selección por `includes` o posición.

Recomiendo `relax_column_count:false` para el bloque de datos, usando el ancho del encabezado como referencia explícita. Parsear solo datos con arrays y comparar filas entre sí no basta: todas podrían tener el mismo ancho incorrecto respecto del header. Se puede anteponer el encabezado al bloque estricto o comprobar cada longitud contra el header antes de construir objetos. Relajar comillas tampoco debe ocultar CSV ambiguo: probar el archivo real con comillas estrictas y documentar cualquier excepción mínima antes de activarla.

Tipos estructurales CSV: celdas textuales por formato; presencia de cada columna del esquema y posición consistente. Un valor `"bad"` dentro de SUMA_NETA es calidad numérica, no cambio de estructura: los parsers numéricos aprobados siguen bloqueando la consulta y permiten conteos. Una fila que omite físicamente el campo es INVALID_ROW_STRUCTURE. Celda vacía con delimitadores presentes es valor ausente, no columna ausente.

## 4. Contrato OData y metadata

La validación debe resolver EntitySet → EntityType de la fuente/proyección correcta, respetando namespaces, aliases y propiedades heredadas si existen. No elegir la primera propiedad llamada SUMA_NETA en todo el documento. Requerir propiedades de la operación, tipo EDM, facetas efectivas y anotaciones que influyan en la interpretación; ignorar descripciones/etiquetas para compatibilidad numérica.

El antecedente 006 verificó SUMA_NETA como Edm.Int64, Nullable omitido (efectivo true), sin Precision/Scale aplicables y con Common.Label. No se renovó esa evidencia. Para otros campos hay que descubrir tipos antes de fijar expectativas.

CSDL distingue tipos y facetas: Nullable omitido en propiedad escalar tiene valor true; Precision/Scale corresponden a los tipos que admiten esas facetas. Aplicar defaults efectivos antes de comparar, no confundir atributo omitido con cambio. [OASIS CSDL V4.0, sección 6.2](https://docs.oasis-open.org/odata/odata/v4.0/os/part3-csdl/odata-v4.0-os-part3-csdl.html).

La negociación V4/IEEE754Compatible y sus errores actuales permanecen. Metadata y payload deben coincidir: Int64 sigue textual/null, propiedades requeridas deben existir en todas las filas proyectadas y un campo no nullable no admite null. Si se omite explícitamente una propiedad no proyectada, no es error. No imponer las propiedades de las filas a anotaciones OData. Rechazar estructuras objeto/array donde se espera escalar. Validar todas las páginas existentes antes de publicar; no cambiar la paginación en esta etapa.

### Frecuencia y disponibilidad

- Primera carga de una fuente/activo: metadata obligatoria antes de aceptar filas. Sin metadata ni contrato observado validado, METADATA_UNAVAILABLE; no inferir tipos del payload.
- Caché de metadata separada por fuente/activo y versión del contrato esperado, con TTL propuesto de 5 minutos, pendiente de aprobación. Compartir una petición en curso. No consultar por celda ni por consumidor del mismo snapshot.
- Lectura de snapshot cacheado válido: no requiere metadata nueva. Si una verificación posterior descubre incompatibilidad, marcar esa fuente como incompatible para nuevas cargas; el snapshot anterior conserva su contrato propio.
- Recarga explícita: revalidar metadata; usar petición condicional con ETag/Last-Modified solo si el servidor los ofrece. HTTP 304 reutiliza exclusivamente el documento validado correspondiente. No se comprobó soporte de validadores del tenant.
- Consultas filtradas nuevas: usar metadata vigente; al vencer, revalidar antes de ejecutar/publicar resultado. Si falla temporalmente, rechazar la nueva operación, conservando entradas previas hasta su TTL original. No prolongar TTL ni servir resultados nuevos validados con metadata vencida silenciosamente.
- Evitar publicación si la versión de contrato cambia mientras se carga. Asociar ticket/generación a la operación. Si hay metadata ETag correlacionable en el payload, compararlo; de lo contrario revalidar al terminar una carga larga o explícita.

Sin marcador de esquema atómico proporcionado por SAP, existe una ventana entre consultar metadata y recibir datos. Revalidación y comprobación del payload reducen el riesgo, pero no garantizan detectar un cambio y reversión entre ambas consultas. Debe documentarse, no prometer consistencia temporal absoluta.

### Lectura XML: decisión pendiente concreta

No hay parser XML de producción declarado en package.json; la búsqueda local encontró un escritor de reportes, no un lector CSDL utilizable. No recomiendo convertir las expresiones regulares de descubrimiento puntual en parser de producción ni crear un framework XML propio.

Antes del paso OData, decidir entre: (A) verificar soporte real de metadata JSON y consumirlo con JSON.parse, sin asumir que SAP lo ofrezca; (B) aprobar por separado un parser XML mantenido, con resolución externa/DTD deshabilitada y límites de tamaño/profundidad. No se agrega ninguna dependencia en esta etapa. Si no se autoriza ninguna opción, puede implementarse CSV/contratos internos primero, pero no declarar completada la revalidación automática CSDL. Invocar PowerShell o .NET desde Node no es una alternativa portable recomendable para el despliegue actual.

## 5. Matriz de compatibilidad propuesta

| Cambio / escenario | Decisión y comportamiento |
| --- | --- |
| Columna adicional única, no usada | Compatible; conservar, registrar cambio observado, no alterar selección de métricas. |
| Cambio de orden de columnas nombradas | Compatible; el mapeo por nombre produce mismos resultados. |
| Reordenamiento de columna anónima con datos | No se puede demostrar identidad; requiere layout explícito o revisión, no inferencia. |
| Cambio de nombre sin alias declarado | Incompatible si requerido; MISSING_REQUIRED_COLUMN. Si opcional no usado, compatible como eliminación + adición. |
| Alias aprobado inequívoco | Compatible según revisión de contrato; no normalizar dos nombres presentes al mismo rol. |
| SUMA_NETA Int64 → Decimal/String/Double | Incompatible con perfil vigente aunque los valores del ejemplo sean enteros. INCOMPATIBLE_METRIC_TYPE. |
| Int64 → Int32 | Potencialmente compatible de dominio, pero no automático: la representación JSON negociada cambia. Exige adaptador/perfil aprobado. |
| Propiedad opcional ausente | Compatible si ninguna operación solicitada la requiere; esa operación debe fallar o declarar capacidad no disponible. |
| Propiedad obligatoria ausente | Incompatible; no publicar candidato. |
| Nullable true → false | Compatible para lector que ya admite true, si payload cumple false; nueva restricción no permite aceptar null. |
| Nullable false → true | Compatible solo si contrato esperado y consumidor ya contemplan ausencia; si exigen presencia no nula, incompatible. Nullable omitido se compara con su default efectivo. |
| Null permitido en métrica | Estructura válida; calidad/cobertura bloquea cálculo según Etapas 2A/2B, no bloquea conteos. |
| Faceta decimal Precision/Scale cambia | Evaluar contra rango/escala admitidos; ampliación fuera de capacidades incompatible; reducción puede ser compatible. No hay perfil decimal aprobado hoy. |
| Cambio de etiqueta/documentación | Compatible; no invalida interpretación. |
| Cambio de unidad/moneda o ruta de anotación usada | Requiere revisión semántica; no asumir compatibilidad por conservar tipo EDM. |
| Encabezado duplicado o colisión normalizada | DUPLICATE_COLUMN; rechazo antes del mapeo. |
| Fila CSV corta/larga | INVALID_ROW_STRUCTURE; rechazar dataset completo, conservar anterior. |
| Misma cantidad de campos pero intercambio de dos strings | Puede escapar a validación estructural; requiere controles de dominio. Riesgo residual explícito. |
| Encabezado doble válido | Compatible tras resolver huecos sin conflicto y comprobar ancho. |
| Columna de relleno contiene datos | Incompatible con su declaración de relleno; no descartarla. |
| Metadata cambia con dataset cacheado | Comparar candidato con contrato esperado; mantener snapshot anterior y sus derivados. Nueva publicación compatible invalida ambos derivados. |
| Error temporal de metadata | No publicar datos nuevos sin validación vigente; mantener snapshot anterior hasta TTL original; error estructurado en recarga. |
| Recarga incompatible | Rechazar sin sustituir ni invalidar dataset/índice/perfil vigentes. No usar EXPORT como sustitución silenciosa. |
| Snapshot vacío | Validar por header/metadata y proyección; no inferir esquema vacío desde primera fila inexistente. |
| Copia/filtro de snapshot | Heredar contexto explícitamente; subset de filas conserva esquema, proyección reduce capacidades declaradas. |
| Transformación cambia columnas/tipos | Revalidar contrato de salida; nuevo snapshotId y linaje. Nunca registrar automáticamente como validado. |

## 6. Arquitectura mínima y versionado

Proponer dos módulos funcionales pequeños y una ampliación del registro existente:

1. `src/config/schemaContracts.js`: objetos de contrato por fuente/capacidad, revisión explícita, nombres canónicos/aliases permitidos, obligatorios/opcionales, tipos/facetas conocidos, perfiles numéricos y layout CSV. Nada de URLs privadas ni IDs del tenant en contratos versionados.
2. `src/services/SchemaContractService.js`: valida header/filas/esquema normalizado/proyección y clasifica diferencias. Produce errores seguros. Funciones puras para comparación; no repositorio genérico de esquemas.
3. `src/services/ODataMetadataService.js`: GET autenticado, caché pequeña por activo, condicionales, extracción normalizada mediante la opción aprobada. Sin carga de datos ni cambios de paginación. No seguir referencias XML o redirects a terceros con credenciales automáticamente.
4. Ampliar el registro WeakMap actual de `numeric.js` o extraer un `DatasetContext` si mejora la dependencia: un único contexto inmutable asociado al array, compartido por números y esquema. Mantener las APIs actuales de registro para compatibilidad, con contexto estructural añadido en providers.

Contexto propuesto: `source`, `contractId/revision`, `observedSchemaHash`, `interpretationHash`, `snapshotId`, `projection`, `capabilities`, `metricProfiles`, `validatedAt`, `parentSnapshotId` y mapa de roles. Son metadatos internos; no cambian automáticamente el JSON de endpoints.

`observedSchemaHash` se calcula sobre representación canónica ordenada de propiedades/facetas/anotaciones relevantes, no sobre XML bruto ni filas. `interpretationHash` cubre roles/perfiles relevantes; puede permanecer igual ante adición decorativa. Usar crypto de Node, sin dependencias. No publicar hashes de identificadores privados ni usarlos como prueba de autenticidad. La revisión del contrato esperado cambia solo por aprobación, nunca se aprende de un candidato incompatible.

Pipeline: leer → extraer esquema → comparar contrato/capacidad → validar estructura de todas las filas → adjuntar contexto → publicar candidato. Validación en provider para evitar pérdida temprana y guardia en DataService antes de `_invalidateDerivedCaches`; no duplicar trabajo fila a fila si existe un resultado de validación confiable del mismo candidato.

Un error estructural no debe activar ExportService ni convertirse en contexto de texto exitoso en getInsights. Extender guardas de fallback y propagación con la clase de error estructural. Validar también consultas OData filtradas y fetchMovMat antes de retornarlas, aunque no pasen por MOVMAT_DATA.

Publicación sigue atómica en el bloque síncrono existente. Solo tras éxito se reemplaza snapshot y se invalidan MOVMAT_INDEX_V1/MOVMAT_PROFILE_V1 juntos, aun si la evolución es compatible y llegaron filas nuevas. Los derivados se atan a snapshotId + interpretationHash (además de identidad si se conserva). Al fallar, no mutar contexto anterior ni claves derivadas.

Una función explícita de derivación debe crear otro array y transferir contexto: filtro/slice conserva contrato; selección de columnas declara proyección; mapeo de valores requiere validar salida. No sobrescribir globalmente Array.prototype ni tratar cualquier array nuevo como CSV. En límites de producción, falta de contexto validado debe fallar antes del cálculo; conservar invocaciones unitarias antiguas sin procedencia requiere un adaptador de test explícito o una transición controlada, sin modificar indiscriminadamente las 170 pruebas.

## 7. Estrategia de errores

Propuesta de envelope con claves existentes y detalle seguro:

```json
{
  "success": false,
  "error": "La estructura de la fuente no cumple el contrato esperado.",
  "code": "SCHEMA_CONTRACT_MISMATCH",
  "details": { "source": "CSV", "reason": "DUPLICATE_COLUMN", "phase": "header" }
}
```

Razones: MISSING_REQUIRED_COLUMN, DUPLICATE_COLUMN, INCOMPATIBLE_METRIC_TYPE, INVALID_ROW_STRUCTURE, INCOMPATIBLE_NULLABILITY, INCOMPATIBLE_ANNOTATION, UNVALIDATED_SNAPSHOT. METADATA_UNAVAILABLE es código separado de indisponibilidad, no evidencia de incompatibilidad.

Proponer 500 para contrato estructural de CSV/configuración del servidor; 502 para payload/metadata OData incompatible; 503 para imposibilidad temporal de obtener metadata necesaria. Conservar ODATA_TRANSPORT_ERROR y DATA_QUALITY_ERROR existentes. Nunca incluir fila, valor, nombre externo no aprobado, cuerpo remoto, ruta, token o stack. Puede publicarse un rol lógico de una lista permitida y conteos de fallos; no acumular mensajes con muestras. No usar 422 por fallos internos del dataset.

Controllers/chat deben propagar errores sin afirmar exactitud, ganador o cero. La respuesta de recarga falla aunque el snapshot anterior siga disponible para lecturas válidas: no ocultar el fallo devolviendo éxito con datos viejos. Un error de estructura bloquea publicar todo el candidato; un dato numérico inválido en estructura válida conserva la política de conteos aprobada.

## 8. Plan incremental y pruebas

1. Aprobar obligatoriedad/capacidades, columnas anónimas, política metadata y lector CSDL. Congelar fixtures sintéticas y ejecutar baseline 170 sin cambios.
2. Añadir regresiones que fallen por truncamiento, duplicados, normalización, relleno con datos y header doble ambiguo. Implementar validación CSV previa al mapeo. Verificar ancho y resultados del archivo local sin divulgar valores.
3. Añadir contexto/versiones y derivaciones; proteger publicación y fallback. Probar recarga incompatible preservando identidad y resultados del dataset/índice/perfil anterior; éxito compatible invalida derivados juntos.
4. Implementar metadata bajo la decisión aprobada, con HTTP sintético: primera carga, TTL, single-flight, 304, expiración, fallo, cambio compatible/incompatible y fuente diferente. No usar tenant real en tests automatizados.
5. Integrar validación por proyección en OData completo/filtrado/fetchMovMat/count. Probar propiedades heredadas/aliases, defaults, campos extra, ausencia, objetos en lugar de escalar, páginas inconsistentes y carrera de versión. Mantener la paginación actual.
6. Sustituir heurísticas de selección de columnas solo en consumidores afectados por roles validados. Probar adición de columnas de nombre parecido sin cambio de resultados, orden variable, cero filas y capacidades ausentes.
7. HTTP/chat: cada error estructural debe tener estado/código seguros y nunca respuesta numérica engañosa. Probar que no se invoca fallback ni generación de una cifra tras error. Ejecutar las 170 pruebas y las nuevas, revisar diff y documentar resultados reales.

Criterios de aceptación: ningún campo se descarta/sobrescribe por tolerancia estructural; compatibilidad se decide por reglas y no solo hash; validación ocurre antes de publicación y en rutas directas; las copias autorizadas conservan contrato; ningún candidato incompatible sustituye un snapshot válido; los errores no filtran datos; cambios adicionales/reordenamientos compatibles no requieren editar código; reglas numéricas CSV/OData y conteos independientes permanecen intactas.

## 9. Decisiones pendientes y límites

Requieren aprobación: seis campos obligatorios para carga completa frente a capacidades parciales; tratamiento de COL_2 y layouts anónimos; revisión del alias COL_8; TTL de metadata (propuesto 5 minutos), recarga forzada y comportamiento tras vencimiento; códigos HTTP nuevos; resolución del lector CSDL sin inventar soporte JSON ni desarrollar XML genérico; transición de arrays no registrados en límites productivos.

Riesgos no reproducidos como incidente: cambio de metadata del tenant durante paginación, falsa detección de header por preámbulo, sobrescritura de propiedades OData normalizadas y columnas extra que alteren heurísticas. El código permite esos riesgos, pero no se observaron en datos reales durante esta etapa. No se inspeccionó metadata nueva ni se certificó tipo de dimensiones.

EXPORT continúa sin contrato numérico ni estructural real comprobado. Puede reutilizar validadores de ancho/duplicados para un archivo obtenido legítimamente, pero no heredar esquema del CSV local. Establecer requisitos estructurales mínimos para conteos antes de permitirlos; no ejecutar jobs durante esta propuesta.

No se ejecutó Jest en esta etapa documental; las 170 pruebas son el baseline aprobado por el usuario, no un resultado nuevo afirmado. Se ejecutaron sondas Node sintéticas y lectura estructural del CSV local. Comandos de revisión: `git status --short`, `git branch --show-current`, búsquedas rg de consumidores y `git diff --check`. Único archivo añadido: este documento. No implementar hasta autorización.
