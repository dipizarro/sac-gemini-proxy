# Issue 001 — Etapa 4B.2: integración analítica de completitud OData

Fecha: 2026-11-05. Base aprobada: `e816277`, rama `issue-motor-analitico-confiable`. Estado inicial de Git limpio. Cambios locales, sin commit ni push.

## 1. Resultado y condición de activación

Se integró el paginador a los consumidores productivos y se añadieron guardas de cobertura antes de los cálculos. **La continuación del activo real sigue sin certificarse y las operaciones que requieren conjuntos completos están deshabilitadas para ese activo.** Devuelven un error saneado, no cifras parciales ni un fallback offset/EXPORT.

La suite final ejecutada pasó: **384/384 pruebas, 15 suites**. Incluye los 345 casos anteriores, con las adaptaciones de expectativas y fixtures descritas abajo, más 39 casos nuevos.

No se realizaron nuevas consultas SAP. La evidencia disponible en 013/014 no identifica un filtro pequeño **no vacío** con cardinalidad verificada; no se intentó descubrirlo mediante una descarga amplia. Los éxitos de recorrido completo de las pruebas se limitan explícitamente a servicios sintéticos.

## 2. Integración implementada

### Selección de modalidad

| Consumidor | Modalidad / comportamiento |
| --- | --- |
| `ODataProvider.fetchAllMovMatData` / `loadData` | COMPLETE_COLLECTION; exige cobertura completa antes de entregar el array normalizado. |
| `executeFilteredQuery` con filtro, sin top ni count | COMPLETE_FILTERED. |
| `executeFilteredQuery` sin filtro/top/count | COMPLETE_COLLECTION; nunca la antigua descarga de una sola página. |
| `executeFilteredQuery` con count | SERVER_COUNT; conserva el retorno escalar previo. |
| `executeFilteredQuery` con top | TOP_N global deliberado. Un top inválido, incluido cero, no se interpreta como ausencia de límite. |
| `DataService.fetchMovMat` | TOP_N por defecto, N=50. `top:null` solicita modalidad completa, filtrada o global según corresponda. |
| `DataService.getInsights` | Exige snapshot completo del provider antes de sumar, contar o generar contexto. |
| Chat | Exige cobertura registrada antes de invocar el motor analítico o construir contexto numérico para Gemini. SERVER_COUNT se trata separadamente. |

`ODataProvider.traverse` aplica la política de capacidades antes de llamar al paginador. `ODataCapabilities.forConfiguredAsset()` mantiene `continuationSupported:false`, sin variable de entorno, flag HTTP ni opción de consulta que permita activarlo. La operación completa no inicia solicitudes de datos ni metadata cuando falta certificación. Los tests usan mocks locales del módulo para representar un servicio sintético certificado; no cambian la política productiva.

SERVER_COUNT permanece habilitado como mecanismo previamente observado en 013. Cada respuesta sigue validándose: representación segura de count, transporte, estructura y ausencia de filas/continuación inesperadas. Esta habilitación no certifica soporte de todos los filtros posibles ni convierte un count en prueba de completitud de otra descarga; cualquier error remoto se propaga saneado.

Se retiró del provider el bucle top/skip y su criterio de página corta. ODATA_PAGE_SIZE ya no gobierna este recorrido. No se implementaron offset, deduplicación ni reintentos. El top de centros del chat sigue aplicándose **después** de agregar todas las filas del alcance; no se traduce a un TOP_N de registros.

### Normalización y contratos existentes

El paginador admite la opción interna booleana `normalize`. Aplica la misma normalización de nombres y exclusión de anotaciones que hacía el provider, después de validar las páginas originales y antes de `schema.finish` y del registro de cobertura. Es una transformación controlada uno a uno de la captura; evita perder el contexto al crear el array normalizado.

No se modificaron CSDL, metadata/TTL/single-flight, ODataTransport, odata-int64, perfiles numéricos ni contratos CSV. `numeric.js` únicamente expone una consulta de procedencia por identidad; no cambia conversiones ni acumulados. La cobertura no valida una métrica: un conjunto completo con un Int64 inválido conserva el rechazo numérico aprobado. Los conteos de un conjunto completo siguen siendo independientes de nulls o errores en SUMA_NETA.

## 3. Contexto interno y protección analítica

`ODataCoverageService` utiliza un WeakMap por identidad del array, independiente del contexto estructural y numérico. El registro lo realiza el paginador tras finalizar el recorrido y la validación estructural. Guarda la evidencia y una copia de las referencias de fila, para detectar truncado, sustitución o reordenamiento del array antes de utilizar su cobertura.

- `get(rows)` consulta evidencia, sin inferirla por contenido.
- `requireComplete(rows, collection)` exige identidad registrada, estado COMPLETE y modalidad de enumeración completa. Excluye TOP_N y el array vacío de SERVER_COUNT. Cuando collection es true, tampoco admite un subconjunto COMPLETE_FILTERED.
- `assertAnalytic(rows)` aplica esta exigencia a arrays con procedencia OData o filas OData conocidas. Reconoce copias mixtas por identidad; no cachea una clasificación que pudiera quedar obsoleta al mutar el array.

Las guardas se ejecutan **antes de los retornos por dataset vacío y antes de calcular** en QueryEngineService, InsightEngineService, SummaryService, IndexService, DatasetProfileService y los agregadores de DataService. El chat exige cobertura incondicionalmente para su resultado OData, incluso si recibe un array sin ninguna procedencia registrada.

No se transfiere cobertura a `slice`, `filter`, clones profundos ni `schema.copyContext`. Esta última API conserva su función estructural/numérica; no acredita el alcance de una transformación. Las operaciones analíticas sobre copias conocidas fallan aunque sus celdas sean numéricamente válidas. Se conservan pruebas directas del parser para demostrar que la transferencia numérica explícita sigue funcionando.

La comprobación de procedencia/identidades es lineal por entrada analítica, no un escaneo por cada valor leído. `numeric.readMetric` mantiene sus comprobaciones O(1) de identidad por fila. Las validaciones de esquema existentes también se ejecutan antes de consumir snapshots acreditados.

Límites del mecanismo:

- Los arrays genéricos de los motores mantienen su compatibilidad previa para usos CSV/legados; no se pretende inferir el origen de un clon profundo o de un array vacío arbitrario. **Nunca adquieren contexto OData ni cobertura por semejanza**. En las fronteras productivas OData se exige el registro antes de aceptar esos arrays; no se deben omitir estas fronteras al añadir consumidores.
- El registro es una API interna de confianza, no una operación pública HTTP ni una certificación basada en campos enviados por un cliente.
- Se conserva la mutabilidad previa de las filas. Se detectan cambios en la composición del array y se revalidan tipos/columnas; no se almacena una huella histórica de cada valor de negocio. Las transformaciones semánticas de valores no están autorizadas para reutilizar la cobertura. No se afirma inmutabilidad profunda ni consistencia transaccional.

## 4. Caché y fallos

`ODataProvider.assertSnapshot` exige esquema válido y cobertura COMPLETE_COLLECTION. DataService lo utiliza antes de publicar MOVMAT_DATA. La lectura de un snapshot OData cacheado también pasa por la guarda analítica; los snapshots OData anteriores sin registro de cobertura no se promueven automáticamente.

El orden de publicación e invalidación permanece sin cambios: primero terminar carga y validaciones; solo después sustituir dataset e invalidar derivados. Un error de completitud, transporte o estructura mantiene el objeto anterior y las entradas de MOVMAT_INDEX_V1/MOVMAT_PROFILE_V1, incluidos sus vencimientos originales. La recarga propaga el error y no responde éxito con el snapshot anterior.

Se incorporó PaginationError a la lista de errores que no activan EXPORT. Además, los errores inesperados de una carga OData se sanean y tampoco activan ese fallback. No se alteró el comportamiento del fallback CSV previamente aprobado.

## 5. Respuestas HTTP y exactitud

### Errores

El middleware reconoce PaginationError y conserva el envelope `{ success:false, error, code, details }`. No serializa `coverage.scope`, filtros, URLs, filas parciales, stack, tokens ni cuerpos remotos.

| Situación | Código / HTTP |
| --- | --- |
| Continuación no certificada | ODATA_COMPLETENESS_ERROR / CONTINUATION_UNCERTIFIED / 503 |
| Cobertura ausente, LIMITED o transformación no registrada | ODATA_COMPLETENESS_ERROR / UNVALIDATED_COVERAGE / 503 |
| Composición del snapshot alterada | ODATA_COMPLETENESS_ERROR / SNAPSHOT_CHANGED / 503 |
| Alcance de colección requerido pero solo hay subconjunto | ODATA_COMPLETENESS_ERROR / INCOMPLETE_SCOPE / 503 |
| Presupuesto agotado o TOP_N sin suficientes filas/evidencia | Código y razones del paginador / 503 |
| Incompatibilidad de enlace/count | Código del paginador / 502 |
| Transporte, estructura o calidad numérica | Códigos y estados aprobados anteriormente |

503 expresa que el servidor no puede acreditar la cobertura necesaria bajo su política/capacidad actual; no implica que un reintento automático vaya a resolverlo. No se usa 422 para este problema interno. El error de copia no registrada en un agregador puede aparecer ahora como falta de cobertura 503 antes de alcanzar el antiguo error estructural 502; la prueba directa del parser conserva ese error estructural anterior.

### Chat

Un resultado OData con cobertura completa certificada **no** produce `exact:true`. Las respuestas analíticas indican `exact:false`, `temporalConsistency:UNVERIFIED` y `coverage:COMPLETE`; los templates de insights y el contexto destinado a Gemini explicitan la ausencia de garantía transaccional. No se envían cifras de recorridos parciales a Gemini.

SERVER_COUNT utiliza `countBasis:SERVER_REPORTED`, `exact:false` y `temporalConsistency:UNVERIFIED`. Su texto identifica el valor como conteo reportado por el servicio para esa consulta. No se inventa una fotografía temporal a partir del escalar. CSV mantiene las expectativas de exactitud y los contratos previos; no se añadieron estos campos a sus respuestas de insights.

Se eliminó el log de la ruta/intención que podía contener slots privados.

### Preview OData

`/ds/movmat` utilizaba una ruta residual de proxy con autenticación Basic y JSON sin el transporte aprobado. Se conectó a `DataService.fetchMovMat`, con OAuth, esquema, IEEE754 y TOP_N. Este cambio es necesario para que una entrada productiva de ChatController no eluda los controles integrados.

Mantiene el campo `value` y añade una descripción pública mínima de cobertura (`status`, `mode`, `temporalConsistency`). No devuelve enlaces privados ni el envelope remoto completo. Una muestra de 50 filas es LIMITED, no apta para totales; menos de 50 sin agotamiento respaldado produce 503 sin filas parciales. `fetchMovMat` conserva count textual cuando el recorrido lo recibió validado. Este ajuste afecta a consumidores que dependieran de anotaciones/enlaces del proxy bruto y debe considerarse al desplegar; no exige una arquitectura nueva ni modifica rutas.

## 6. Archivos modificados

| Archivo | Justificación |
| --- | --- |
| `src/services/ODataCapabilities.js` (nuevo) | Política de activación cerrada para el activo configurado. |
| `src/services/ODataCoverageService.js` (nuevo) | Registro y exigencia explícita de cobertura. |
| `src/services/ODataPaginationService.js` | Rechazo saneado de null/opciones no admitidas, normalización controlada y registro de cobertura. |
| `src/providers/ODataProvider.js` | Sustituye lecturas anteriores por modalidades del paginador y aplica la política de certificación. |
| `src/services/DataService.js` | Fetch paginado, guardas de agregados/insights/caché y prohibición de fallback OData. |
| `src/services/QueryEngineService.js`, `InsightEngineService.js`, `SummaryService.js` | Guardas previas a sumas, rankings, estadísticas, comparaciones y conjuntos. |
| `src/services/IndexService.js`, `DatasetProfileService.js` | Impiden construir derivados analíticos a partir de OData limitado/no acreditado. |
| `src/utils/numeric.js` | Consulta de procedencia para las guardas; parser y perfiles intactos. |
| `src/controllers/ChatController.js` | Frontera de confianza, tratamiento de exactitud/count, contexto de Gemini y preview seguro. |
| `src/middlewares/errorHandler.js` | Respuesta saneada para errores de completitud. |
| `tests/ODataPagination.test.js` | Cinco regresiones de opciones. |
| `tests/ODataCompleteness.test.js` (nuevo) | 34 regresiones de integración y HTTP. |
| `tests/ODataSchema.test.js`, `tests/ODataNumeric.test.js` | Adaptaciones explícitas de fixtures/expectativas históricas, sin eliminar casos. |
| Este documento | Evidencia, cambios de comportamiento y pendientes. |

## 7. Pruebas antes/después

| Ejecución | Resultado real |
| --- | --- |
| Baseline antes de editar | 345/345, 14 suites, 17,338 s. |
| Primeras regresiones, antes de la integración | 13 fallaron y 61 pasaron entre paginador e integración. Se reprodujo TypeError de traverse(null), opciones ignoradas, total parcial del chat e insights aceptados; algunos escenarios certificados fallaron porque aún no existía el módulo de capacidades. |
| Integración inicial con fixtures históricos sin adaptar | 63 fallos por el nuevo bloqueo de operaciones no certificadas, entre otros cambios de contrato de copias. No se habilitó producción para hacerlos pasar. |
| Tras adaptar fixtures sintéticos y añadir guardas/casos | 376/376 y después 381/381 en ejecuciones completas. |
| Ampliación de HTTP preview/recarga | Dos fallos del cliente de pruebas: enviaba cuerpo en GET y no capturaba el error de parseo de una respuesta vacía. Se corrigió el helper, sin relajar producción. |
| Integración HTTP tras esa corrección | 34/34 casos. |
| **Suite completa final** | **384/384, 15 suites, 20,828 s; sin handles pendientes.** |

Cambios intencionales de pruebas anteriores:

1. Las suites estructural y numérica mockean capacidades **solo para su endpoint sintético**; así siguen alcanzando las validaciones que verificaban antes.
2. Los fixtures de segunda página declaran nextLink; ya no dependen de pageSize/offset para llegar a la página inválida.
3. Las copias sin cobertura rechazan ahora tanto sumas como conteos analíticos. Se conserva la prueba de conteo sobre el original y la independencia de errores numéricos.
4. Las comprobaciones de paridad, rango, formato y rendimiento del parser sobre `copyContext` usan `numeric.readMetric`/`numeric.add` directamente: el contrato numérico continúa válido, pero el agregador productivo ya exige cobertura. Las nuevas pruebas comprueban además que `copyContext` no habilita agregaciones.
5. La expectativa HTTP del agregador sobre copia no registrada cambia de 502 estructural a 503 de cobertura; la prueba directa de identidad del parser mantiene SCHEMA_CONTRACT_MISMATCH.

No se eliminaron ni omitieron tests ni se agregaron dependencias. Las pruebas nuevas y adaptadas usan exclusivamente XML/JSON sintéticos. Los casos HTTP levantan Express local y mockean la red SAP.

Cobertura nueva: recorrido completo certificado; capacidad no certificada; chat con nextLink; consulta parcial; SERVER_COUNT válido; TOP_N limitado/subllenado; ranking global después de varias páginas; fallo de segunda página; presupuesto agotado; estructura incompatible; recarga que conserva dataset/derivados/TTL y responde error HTTP; copias/transformaciones/mutaciones; snapshots vacíos; contexto arbitrario rechazado por chat; ausencia de envío parcial a Gemini; preview seguro; errores saneados y compatibilidad CSV mediante la suite existente.

Comandos desde la raíz del repositorio:

```powershell
node node_modules/jest/bin/jest.js --runInBand --silent --cache=false
node node_modules/jest/bin/jest.js tests/ODataCompleteness.test.js tests/ODataPagination.test.js --runInBand --silent --cache=false
git diff --check
git status --short
```

## 8. Estrategia de activación y pendientes

1. Acordar un filtro no vacío de cardinalidad pequeña verificada, o una colección estable de prueba. Solo entonces ejecutar la sonda autorizada con límites de tiempo/bytes/páginas, sin top/skip. No se realizó esta sonda en 4B.2 por falta de ese alcance.
2. Conservar evidencia vinculada al activo, filtro y comportamiento observado: generación y recorrido de nextLink, terminación, count cuando corresponda, negociación de cada página y restricciones conocidas. Las pruebas sintéticas no sustituyen esa evidencia.
3. Revisar y aprobar la activación de la capacidad para ese activo; actualizar la política interna en un cambio revisado. No habilitar por ambiente, parámetro del cliente ni fallback automático.
4. Aun con continuación certificada, mantener consistencia temporal UNVERIFIED salvo evidencia independiente. La cadena completa y el count coincidente no detectan todas las alteraciones compensadas ni certifican snapshot isolation.
5. Definir, si se necesita, transferencia explícita de cobertura para transformaciones con nuevo alcance. Hoy ninguna copia la hereda automáticamente. El alcance filtrado debe seguir correspondiendo a la operación solicitada; no reutilizar un resultado filtrado como colección global.
6. Mantener las limitaciones de 4B.1 sobre abortos de OAuth/metadata y revalidación por TTL. No se modificaron esas APIs ni el lector CSDL.
7. Revisar a los consumidores del antiguo proxy bruto y el impacto operativo: los totales/insights/cargas completas OData responderán 503 hasta la certificación. SERVER_COUNT y muestras TOP_N satisfechas permanecen disponibles con su alcance explícito.

La integración queda preparada para revisión local. **No se activó completitud del activo real, no se consultó el tenant y no se realizó commit ni push.**


## 9. Correcciones de revisión de 4B.2 — 2026-11-11

Base revisada: commit `2b26a5d`; estado inicial de Git limpio. Esta sección sustituye las limitaciones y descripciones anteriores relativas a la aceptación indiscriminada de COMPLETE_FILTERED y al fallback conversacional OData. Sin commit ni push.

### Hallazgos confirmados antes de corregir

1. Una captura completa del filtro de una fecha podía utilizarse para calcular otra fecha y devolver un cero sin fundamento. La guarda comprobaba COMPLETE, pero no el alcance solicitado. MOVMAT_DATA también aceptaba en lectura un snapshot de subconjunto.
2. Una intención general `unknown` intentaba cargar OData y respondía 503 por falta de certificación, aun cuando solo se necesitaba ayuda sobre capacidades.

Se añadieron primero cinco regresiones: las cinco fallaron antes de modificar la lógica; las 34 pruebas de integración anteriores pasaron. La primera ejecución completa incluyó esas nuevas regresiones mientras se preparaban: **384 casos pasaron y los cinco nuevos fallaron**. No se presenta esa ejecución como un baseline limpio de 384 casos aislados.

### Solución de alcance: contratos cerrados, no equivalencia de filtros

Se añadió `ODataQueryScope.js` con tres descriptores explícitos:

| Descriptor | Filtro generado | Operaciones autorizadas sobre ese subconjunto |
| --- | --- | --- |
| `{ kind: 'DATE', date }` | Igualdad de FECHA | Conteo de movimientos, centros distintos y ranking de centros de esa misma fecha. |
| `{ kind: 'DATE_GROUP', date, group }` | Igualdad de FECHA y GRUPO_ARTICULOS | Suma por esa misma fecha y ese mismo grupo. |
| `{ kind: 'RANGE', from, to }` | Intervalo inclusivo de FECHA | Centros distintos para esos mismos límites. |

Se validan campos del descriptor, fechas reales ISO, orden del intervalo y grupo textual no vacío. El grupo se escapa al generar el filtro. No se busca un nombre de columna dentro de un texto ni se interpreta un filtro OData libre.

`executeFilteredQuery({ scope, ... })` normaliza y congela el descriptor, **genera el filtro a partir de él**, ejecuta el recorrido y registra el descriptor por identidad del array en un WeakMap privado del provider. No admite proporcionar simultáneamente `scope` y `filter`. No hay una API pública de registro que permita añadir un descriptor a un resultado de un filtro arbitrario; `scopeFor` solo consulta el registro privado. La cobertura general sigue estando en ODataCoverageService.

Las consultas con `filter` libre conservan su lectura cuando existe certificación, pero no adquieren un contrato analítico de subconjunto. Incluso un filtro cuyo texto sea exactamente igual al generado por el contrato queda rechazado para agregaciones si no procede de ese punto de entrada. La distinción es la procedencia del plan, no una comparación de strings de filtro.

`requireComplete(rows)` y `assertAnalytic(rows)` exigen ahora colección completa por defecto. Un consumidor especializado puede pasar un descriptor solicitado. Solo se admiten:

- COMPLETE_COLLECTION, suficiente para las operaciones locales del motor.
- COMPLETE_FILTERED con descriptor privado acreditado **idéntico en tipo y valores** al solicitado por el consumidor.

La política es deliberadamente conservadora: no se intenta demostrar que un rango amplio contiene otro menor, ni que un filtro DATE puede autorizar DATE_GROUP. Esas capturas se rechazan aunque alguna inclusión pudiera ser válida; el llamador debe solicitar el contrato exacto o una colección completa. Insights mensuales, comparaciones, estadísticas, perfiles y agregadores genéricos necesitan COMPLETE_COLLECTION.

QueryEngineService entrega a la guarda los argumentos reales de cada operación, antes de cualquier retorno por dataset vacío. Su índice de centros por fecha recibe el mismo contrato explícito; los demás usos de IndexService mantienen la exigencia global. Así se rechazan otra fecha, otro grupo o periodo, incluso sobre un array vacío. No se transfieren contrato ni cobertura a slice/filter/copyContext ni clones.

El chat construye únicamente los contratos que sus operaciones implementan. Las comparaciones/insights no cubiertos por estos tres descriptores solicitan colección completa y aplican después sus cálculos locales. Si los slots introducen una restricción de fecha, rango, grupo o centro que la operación no soporta, devuelve INCOMPATIBLE_SCOPE antes de consultar datos, en lugar de descartarla silenciosamente. Un ejemplo es un conteo por fecha con una restricción adicional de centro no implementada.

### Caché y consumidores globales

`DataService.getRowsCached` exige explícitamente `requireComplete(rows, true)` cuando la fuente activa es OData. Un snapshot COMPLETE_FILTERED o un array arbitrario sin cobertura se rechaza en lectura; una colección acreditada sigue siendo válida. No se modifica la entrada, el TTL ni los derivados al rechazarla. Las cargas ya exigían colección completa antes de publicar y mantienen esa protección.

La restricción de alcance produce ODATA_COMPLETENESS_ERROR, HTTP 503, con INCOMPLETE_SCOPE o INCOMPATIBLE_SCOPE según corresponda. Los detalles no incluyen filtros, fechas, grupos, URLs, claves ni registros. No se alteran los códigos estructurales, el perfil Int64 ni la consistencia temporal UNVERIFIED.

### Conversación general sin consulta de datos

ChatController distingue las intenciones analíticas soportadas antes de invocar al provider. Conserva el retorno temprano de aclaraciones y la modalidad SERVER_COUNT. Normaliza los alias analíticos ya reconocidos por el query builder.

En estrategia ODATA, una intención general/no soportada recibe una respuesta determinista de ayuda: indica las operaciones disponibles y pide operación/periodo/grupo cuando proceda. No consulta Datasphere ni llama a `GeminiService.generateResponse` para redactar cifras. El router puede seguir usando su modelo para clasificar la intención; no recibe un dataset OData en ese paso.

Esto también evita que una pregunta numérica clasificada como unknown se derive a una respuesta numérica improvisada: recibe ayuda sin cifras de negocio. Una intención numérica soportada conserva el bloqueo 503 cuando no hay certificación. Esta política no cambia el flujo CSV ni su fallback conversacional.

### Archivos de esta corrección

- `src/services/ODataQueryScope.js`: nuevo contrato cerrado y generador de filtro.
- `src/providers/ODataProvider.js`: ejecución desde scope y registro privado del alcance.
- `src/services/ODataCoverageService.js`: colección por defecto y correspondencia explícita del subconjunto.
- `src/services/QueryEngineService.js`, `src/services/IndexService.js`: alcance requerido derivado de los argumentos de la operación.
- `src/services/DataService.js`: exigencia global en lectura de MOVMAT_DATA con fuente OData.
- `src/controllers/ChatController.js`: separación de conversación/analítica y planes explícitos.
- `tests/ODataCompleteness.test.js`: 13 regresiones nuevas, además de conservar sus 34 casos anteriores.
- `tests/ProviderLifecycle.test.js`: expectativa intencional de caché descrita abajo.
- Este documento: evidencia y decisiones de revisión.

No se modificaron capacidades, CSDL, metadata, transporte JSON, paginación, perfiles numéricos, dependencias ni configuración privada. No se consultó SAP.

### Pruebas y cambio intencional de expectativa

Resultados reales:

| Momento | Resultado |
| --- | --- |
| Regresiones iniciales antes de la corrección | 5 fallos nuevos, 34 casos anteriores aprobados en la suite de integración. |
| Primera suite completa con esas regresiones | 384 aprobadas, 5 fallidas. |
| Guardas de alcance iniciales | 388 aprobadas y un fallo en el antiguo fixture de caché sin contexto. |
| Contratos y adaptación de ese fixture | 394/394 aprobadas. |
| Verificación final, incluidas tres regresiones adicionales | **397/397 pruebas, 15 suites; 21,882 s.** |

Se conservan los 384 casos previos. El único cambio intencional de expectativa está en ProviderLifecycle: su provider mock devuelve un array sin contexto, y antes se aceptaba leerlo desde caché bajo DATA_SOURCE=ODATA. Ahora esa lectura debe rechazarse. Se conserva la comprobación de selección del provider asíncrono y de su número de llamadas; la nueva prueba de colección completa acredita el caso positivo con el provider y contratos reales sobre respuestas sintéticas. No se relajó la guarda productiva para permitir el fixture anterior.

Las 13 regresiones cubren fecha distinta, grupo distinto y alcance ampliado incompatible; contrato exacto válido; rango diferente; filtro libre aun con texto coincidente; prohibición de combinar scope y filter; copia defensiva del descriptor; colección/subconjunto en MOVMAT_DATA; preguntas generales, aclaraciones y unknown numérico sin datos; snapshot vacío; copyContext sin transferencia de alcance; y restricciones de centro no soportadas. Los casos anteriores siguen cubriendo preguntas numéricas con HTTP 503, SERVER_COUNT, consistencia temporal, caché y rutas CSV.

Comando final ejecutado:

```powershell
node node_modules/jest/bin/jest.js --runInBand --silent --cache=false
```

También se revisaron el diff, `git diff --check` y la sintaxis de los archivos nuevos/modificados relevantes. Sin cambios ajenos al alcance.

### Pendientes para activación

La continuación real permanece deshabilitada. Los contratos de alcance acreditan qué consulta se ejecutó; no certifican por sí solos que SAP implemente correctamente la continuación, evalúe sus filtros o proporcione consistencia transaccional. Se conserva la política de activación revisada anteriormente.

Si se requieren filtros adicionales por centro, combinaciones de dimensiones o inclusiones entre periodos, deberán añadirse contratos explícitos con su generación y sus pruebas. No ampliar mediante coincidencias de texto ni activar offset. Los arrays genéricos/legados siguen sin adquirir cobertura por semejanza y los puntos de entrada OData continúan exigiendo registro.
