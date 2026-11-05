# Issue 001 — Etapa 3B.2: validación estructural OData

Fecha: 2026-11-05, America/Santiago. Entrega local para revisión; sin commit ni push.

## 1. Resultado

Las rutas OData de carga completa, consultas filtradas y `DataService.fetchMovMat` obtienen un modelo CSDL validado antes de consultar registros. Validan requisitos de la operación y la estructura del payload antes de normalizarlo o publicarlo. Las recargas explícitas fuerzan metadata nueva; un fallo estructural no activa EXPORT ni reemplaza el snapshot vigente.

La comprobación real de lectura aceptó el CSDL con el lector aprobado **sin modificar CsdlReader**. La suite final pasó **278/278 pruebas, 13 suites**, conservando los 236 casos anteriores y agregando 42. No se cambió la paginación, el transporte JSON IEEE754Compatible, las reglas numéricas, los contratos CSV/EXPORT ni las dependencias.

## 2. Compatibilidad real con Datasphere

Se realizaron dos comprobaciones controladas fuera de Jest, exclusivamente sobre `$metadata`, con XML en memoria y resultados saneados:

1. GET XML y resolución con CsdlReader para verificar tipos de los seis roles conocidos.
2. GET mediante el nuevo ODataMetadataService y evaluación de `ODataSchemaService.prepare({force:true})`: metadata y contrato aceptados.

Ambos GET respondieron HTTP 200, application/xml y CSDL 4.0. Cada proceso obtuvo su token mediante un POST OAuth Client Credentials; esos POST fueron autenticación, no escritura en SAP. No se consultaron registros, muestras, datasets completos, exportaciones ni jobs. No se guardaron XML, URLs privadas, credenciales, nombres de activos, namespaces privados o etiquetas de negocio.

Tipos/nulabilidad observados para roles ya conocidos y utilizados en el contrato:

| Rol | Tipo EDM verificado | Nullable efectivo observado | Regla del contrato |
| --- | --- | --- | --- |
| MATERIAL1 | Edm.Int32 | true | Tipo exacto; permite nullable true o false |
| FECHA | Edm.Date | false | Tipo exacto y no nullable |
| ID_CENTRO | Edm.String | false | Tipo exacto y no nullable |
| GRUPO_ARTICULOS | Edm.String | true | Tipo exacto; permite nullable true o false |
| CLASE_MOVIMIENTO | Edm.String | true | Tipo exacto; permite nullable true o false |
| SUMA_NETA | Edm.Int64 | true | Escalar Int64; permite nullable true o false |

No se infirieron tipos de dimensiones a partir de su nombre. SUMA_NETA no declara Precision/Scale, coherentemente con Int64. El contrato no inventa esas facetas. El lector resolvió exactamente la entidad configurada, sin buscar una propiedad homónima en otro tipo.

**Límite de esta evidencia:** se comprobó compatibilidad del CSDL, no una carga real completa ni consistencia de registros reales con ese CSDL. Toda la validación de payload, paginación y publicación se probó con respuestas sintéticas.

## 3. Arquitectura y cambios

| Archivo | Cambio y motivo |
| --- | --- |
| `src/config/odataContract.js` | Revisión `movmat-odata-1`, seis roles con tipos/nulabilidad verificados. Contrato independiente de CSV y EXPORT. |
| `src/services/ODataMetadataService.js` | Derivación segura de endpoint, GET XML autenticado, límites y caché de modelos. |
| `src/services/ODataSchemaService.js` | Requisitos por operación, validación de metadata/payload, contexto y transferencia explícita. |
| `src/services/ODataSchemaError.js` | Errores estructurados saneados de disponibilidad, metadata y contrato. |
| `src/providers/ODataProvider.js` | Validación previa a cargas/consultas, comprobación de cada página antes de normalizar, registro final y guardia de snapshot. |
| `src/services/DataService.js` | Validación de fetchMovMat, recarga forzada, última comprobación del provider antes de publicación y exclusión de fallback ante errores estructurales. getInsights propaga errores OData en vez de convertirlos en texto de contexto exitoso. |
| `src/middlewares/errorHandler.js` | Serializa la nueva clase con el envelope existente, sin imprimir excepciones o cuerpos privados. |
| `tests/ODataSchema.test.js` | 42 pruebas nuevas con XML, JSON y URLs sintéticas, incluidos endpoints locales. |
| `tests/ODataNumeric.test.js` | Prepara metadata sintética real y completa las fixtures estructurales; conserva los casos numéricos. Cambio intencional de expectativa para campo ausente. |
| Este documento | Evidencia, resultados, decisiones y límites de integración. |

No se modificaron CacheService, CsdlReader, OAuthService, ODataTransport, numeric.js, los perfiles numéricos ni package.json/lockfile. Se reutilizan los parsers y el registro numérico existentes; no se introduce un framework genérico.

## 4. Adquisición y caché de metadata

La derivación admite exclusivamente la forma de endpoint relacional Datasphere ya verificada, HTTPS, sin usuario/password incrustados, query ni fragmento. Valida la cantidad de segmentos y rechaza separadores codificados o segmentos inválidos; reemplaza únicamente el segmento final por `$metadata`. El nombre del EntitySet se obtiene de ese segmento y se pasa al lector exacto. No se aceptan URLs arbitrarias de metadata aportadas por el payload.

El GET usa `Accept: application/xml`, `redirect: error`, timeout de 15 segundos y Bearer obtenido con OAuthService. No reutiliza FORMAT ni parámetros IEEE754Compatible de datos. La espera de autenticación también está acotada a 15 segundos; si vence, se rechaza la operación aunque la promesa subyacente del servicio OAuth pueda completar después. No se modificó ese servicio.

Se valida HTTP exitoso, ausencia de redirect, MIME XML, charset UTF-8 cuando se declara y OData-Version 4.0 cuando está presente. No se procesa un 304 sin cuerpo. Se comprueba Content-Length y también el tamaño real del stream descomprimido, máximo 2 MiB, antes de llamar al lector. CsdlReader conserva sus presupuestos y controles aprobados. Las excepciones de OAuth/fetch no publican el mensaje original.

Caché privada separada de MOVMAT_DATA:

- Clave por endpoint/entidad y revisión del contrato; máximo cuatro modelos, sin guardar tokens o XML.
- Modelo congelado recursivamente, hash interno, fecha de validación y vencimiento a cinco minutos tras adquisición exitosa.
- Single-flight por clave; máximo dos adquisiciones concurrentes. Peticiones ordinarias/forzadas que coinciden con una adquisición en curso comparten esa validación nueva.
- Sin petición por fila. Una operación prepara su ticket una vez y valida todas sus páginas contra ese modelo.
- Una recarga explícita omite la entrada vigente y consulta metadata. Un fallo elimina la entrada de metadata de esa clave, sin renovarla ni devolverla como validación nueva. No afecta al snapshot de datos anterior.
- Al finalizar una carga se consulta la vigencia/generación del ticket. Si venció, se revalida; si el modelo actual tiene un hash diferente, falla con SCHEMA_CHANGED_DURING_LOAD. Si otro refresh está en curso, espera ese resultado. No hay ETag/304 implementado.

El hash es interno, se calcula sobre el modelo normalizado y no se publica. No sustituye las reglas de compatibilidad: una carga nueva con columnas adicionales compatibles se acepta. Si cualquier cambio de modelo ocurre durante una carga ya iniciada, se exige reintentar para no mezclar interpretaciones, incluso si el cambio sería compatible en una operación nueva.

## 5. Requisitos según operación y payload

### Carga completa

Exige los seis campos del contrato. También conserva/valida las demás propiedades estructurales declaradas por el modelo, sin convertirlas automáticamente en métricas. Cada registro completo debe incluir todas las propiedades estructurales de la proyección completa. La nulabilidad permite null, no la omisión física de una propiedad solicitada.

Cada página se valida antes de normalizar nombres o concatenar filas. Se detectan campos ausentes, tipos de representación incompatibles y propiedades no declaradas. Las colisiones tras normalización se rechazan antes de crear objetos; las anotaciones `@odata.*` del payload se separan de las columnas de negocio.

### Consulta filtrada / fetchMovMat

Una selección explícita exige solo las propiedades proyectadas, además de verificar en metadata las usadas por filtro/orden. Esas propiedades de filtro no tienen que estar en las filas si no se proyectaron. Una selección ausente equivale a carga de todas las propiedades y exige el contrato completo. Una respuesta vacía pasa únicamente después de validar el modelo/requisitos; no se deduce un esquema desde rows[0].

Se admite el subconjunto de filtros que genera el motor: propiedades simples, comparaciones, operadores lógicos, literales numéricos/fecha y strings con comillas escapadas. La extracción de referencias no evalúa filtros; SAP realiza la evaluación. Navegación, parámetros alias y funciones OData no contempladas requieren ampliación explícita y hoy fallan; no se construyó un parser general de consultas. Proyecciones de nombres simples, listas y `*` textual están admitidas.

### Conteos

No exigen SUMA_NETA ni una proyección de métricas. Se validan identidad del modelo y campos realmente usados en filtro. Select/orden ignorados por el provider para count tampoco se convierten en requisitos. Se conserva la conversión segura de @odata.count de ODataTransport. Una métrica ausente o incompatible no impide un conteo que no la utiliza.

### Estructura frente a calidad numérica

Para Int64/Decimal, esta capa comprueba representación textual/null conforme al modelo; no convierte ni valida sus valores numéricos. SUMA_NETA sigue usando exclusivamente el perfil `odata-int64`: texto inválido, null permitido por CSDL o fuera de rango seguro siguen sujetos a los errores de calidad existentes al calcular. Los conteos siguen independientes de esos errores. Un tipo JSON numérico para SUMA_NETA conserva ODATA_TRANSPORT_ERROR del transporte previo.

Las dimensiones verificadas validan representación, rangos de Int32, fecha ISO válida y longitud máxima de String declarada. Colecciones adicionales requieren arrays; su Nullable controla elementos, no autoriza null como colección completa. Los tipos de payload admitidos son el subconjunto explícito String/Date/enteros/Decimal/Boolean/Single/Double; otros tipos adicionales requeridos se rechazan en metadata incluso con cero filas. No se asignan perfiles numéricos a otras columnas.

### Compatibilidad semántica

SUMA_NETA exige tipo exacto Int64; Int32/Decimal/String no se aceptan como sustitutos. Se permite reducir nulabilidad; ampliar a nullable los campos FECHA/ID_CENTRO contradice el contrato verificado. Para SUMA_NETA se admiten anotaciones de presentación conocidas (Common.Label/QuickInfo y Core.Description/LongDescription); otras requieren revisión. Unit/ISOCurrency/Scale relevantes no se reinterpretan automáticamente. Se comprueban también términos Measures en anotaciones del contenedor/set/tipo cuando la operación requiere SUMA_NETA.

Esto es una política conservadora de semántica conocida, no un evaluador general de vocabularios externos. Una etiqueta cambiada es compatible; no se convierte en unidad ni determina aditividad.

## 6. Snapshots, procedencia y protección de caché

El registro WeakMap de ODataSchemaService conserva source ODATA, revisión, hash, UUID del snapshot, proyección y validatedAt. El ticket privado conserva el modelo validado. Los arrays siguen registrados en el mecanismo numérico anterior. `context(rows)` devuelve contexto congelado; no añade campos a filas o JSON HTTP.

`copyContext(original, rows)` admite exclusivamente filas con identidad perteneciente al original, verificadas mediante Set, revalida estructura y transfiere contrato/perfil con nuevo snapshotId y parentSnapshotId. No autoriza clones, cambios de tipos ni proyecciones arbitrarias. El snapshot antiguo conserva su propio modelo aun si la metadata actual cambió.

El provider ofrece `assertSnapshot`; DataService lo ejecuta al recibir el candidato antes de publicar. Solo después se invalidan MOVMAT_INDEX_V1/MOVMAT_PROFILE_V1 y se reemplaza MOVMAT_DATA mediante el mecanismo existente. Las pruebas comparan identidad de las entradas completas de caché, incluido vencimiento, tras una recarga incompatible. Conservarlas no renueva su TTL. Una carga compatible publica e invalida ambos derivados.

Los errores de metadata/esquema se excluyen expresamente del fallback EXPORT, tanto en carga fría como en recarga. Se mantiene el comportamiento anterior para otras fuentes, sin aprobar contratos nuevos de exportación. No se cambió ningún tamaño de página, `$top`, `$skip` ni condición de terminación de la paginación.

## 7. Errores y HTTP

Se conserva `{ success:false, error, code, details }`, con mensaje genérico y `{source:'ODATA', reason}`. Sin columnas privadas, URLs, tokens, XML, cuerpos remotos ni stack en la respuesta o en el logging del middleware para esta clase.

| Caso | Código | HTTP |
| --- | --- | --- |
| Red/autenticación/timeout/HTTP no exitoso o redirect durante metadata | METADATA_UNAVAILABLE | 503 |
| MIME, charset, versión, tamaño, XML inválido/no soportado | ODATA_METADATA_ERROR | 502 |
| Campos requeridos, tipos, nulabilidad, semántica, payload o snapshot incompatible | SCHEMA_CONTRACT_MISMATCH | 502 |
| Transporte JSON/IEEE754/count inválido | ODATA_TRANSPORT_ERROR existente | 502 existente |
| Calidad numérica de valores/acumulados | DATA_QUALITY_ERROR existente | 500 existente |

503 distingue imposibilidad de validar la fuente en ese momento; 502 identifica una representación/contrato upstream que el proxy no puede aceptar. No se usa 422 para defectos del dataset. Son errores aditivos necesarios para esta etapa; no se cambiaron respuestas exitosas. Los errores estructurales de CSV conservan su HTTP 500 anterior.

## 8. Pruebas y resultados reales

1. Estado inicial de Git limpio; baseline **236/236**, 12 suites.
2. Antes de producción, las primeras **23 pruebas nuevas fallaron**: no se consultaba metadata, se aceptaba Decimal/campos ausentes, se publicaban páginas defectuosas y chat devolvía éxito ante contrato incompatible. Los módulos nuevos aún inexistentes también produjeron fallos esperados.
3. Primera integración: **23/23** nuevas aprobadas. Primera suite completa: 24 fallos en fixtures numéricas antiguas que usaban un endpoint genérico y no declaraban metadata; 235 aprobadas.
4. Se adaptaron esas fixtures con un endpoint sintético de la forma requerida, XML sintético procesado por el lector real y campos estructurales completos. No se mockea ni se omite la validación estructural. Los 31 casos numéricos pasaron.
5. Expectativa intencional: SUMA_NETA físicamente ausente ahora rechaza la carga con MISSING_REQUIRED_COLUMN antes del cálculo. Null y valores textuales inválidos conservan las expectativas anteriores de calidad. No se eliminó ningún caso previo.
6. Se ampliaron pruebas de TTL/single-flight, límites de cuerpo, endpoint/redirect/auth seguros, carreras entre páginas, vencimiento durante carga, copias, anotaciones cosméticas, colecciones, HTTP y no generación numérica de chat. Un caso nuevo esperaba mayúsculas en la normalización; se corrigió la expectativa para conservar normalizeHeader existente, sin cambiar producción por esa expectativa errónea.
7. Resultado final: **278/278**, 13 suites, salida 0. Las 42 pruebas nuevas incluyen comprobaciones estructurales, de integración de caché y HTTP; ninguna consulta SAP ocurre dentro de tests.

Comandos ejecutados:

```powershell
node node_modules/jest/bin/jest.js tests/ODataSchema.test.js --runInBand --silent --cache=false
node node_modules/jest/bin/jest.js tests/ODataNumeric.test.js --runInBand --silent --cache=false
node node_modules/jest/bin/jest.js --runInBand --silent --cache=false
git diff --check
git diff --stat
git status --short
```

Las pruebas HTTP locales necesitaron loopback autorizado. `git diff --check` no detectó errores; Git puede avisar normalización LF/CRLF. La revisión del diff no encontró cambios de dependencias, credenciales, CSV/EXPORT, reglas numéricas o paginación.

## 9. Riesgos y pendientes

- No existe una transacción atómica que ligue CSDL y todas las páginas remotas. Se detectan divergencias de payload y cambios de metadata observados; un cambio remoto transitorio que conserve representación y se revierta entre verificaciones puede escapar. El TTL de cinco minutos es deliberado; no se promete consultar metadata por página.
- La política de hash durante una carga es conservadora: un cambio cosmético concurrente puede exigir reintento, aunque la próxima carga sea compatible. No se implementó equivalencia semántica avanzada de hashes.
- Los snapshots/filas permanecen mutables, como antes. La validación ocurre al cargar/publicar y transferir contexto; no se congelan todas las filas ni se intercepta cada mutación posterior. Copias profundas ajenas pierden contexto; deben revalidarse explícitamente, no registrarse automáticamente.
- Campos adicionales de tipos fuera del subconjunto de payload soportado, anotaciones semánticas nuevas y filtros complejos requieren extensión específica con pruebas; no se reinterpretan por heurística. Las referencias externas del CSDL no se descargan.
- No se comprobó ETag/304, ni se implementó negociación condicional. La autenticación subyacente no es cancelable desde esta capa tras el timeout de espera.
- La caché de metadata es local al proceso y acotada; no distribuye validaciones entre réplicas. Las garantías de aislamiento del lector siguen siendo las documentadas en 011.
- La compatibilidad con registros reales queda pendiente de una verificación controlada distinta; esta etapa comprobó exclusivamente el contrato CSDL real. EXPORT continúa sin contrato aprobado.

Cambios locales preparados para revisión. No se realizó commit ni push.

## 10. Corrección de revisión de 743b37f — protección de copias OData

Fecha: 2026-11-05. Estado inicial de Git limpio. Esta corrección cierra la pérdida de integridad numérica en copias superficiales sin registro, sin cambiar la adquisición ni validación de metadata.

### Defecto reproducido

El contexto estructural y el perfil numérico estaban asociados al array. `slice()` y `filter()` creaban arrays nuevos sin ese registro, aunque reutilizaran las mismas filas OData validadas. `numeric.readMetric` protegía identidades CSV, pero permitía que esas filas OData pasaran a `toNumberSmart`. Las regresiones demostraron que no se rechazaban ni el texto sintético `12bad` ni el Int64 sintético `9007199254740993` en una copia no registrada. También faltaba rechazo en arrays mixtos.

### Corrección aplicada

Se añade un WeakSet privado de filas OData en `numeric.js`. `registerSource` marca por identidad los objetos cuando el origen es ODATA. Esto protege tanto las filas registradas por el transporte como los snapshots normalizados y las copias autorizadas; no convierte ese registro numérico en una certificación estructural. ODataSchemaService sigue siendo responsable de validar el contrato.

Antes de usar el conversor legado, `readMetric` comprueba `odataRows.has(row)` si el array no tiene registro numérico. Si la fila es conocida, lanza el error existente `SCHEMA_CONTRACT_MISMATCH`, source ODATA y reason UNVALIDATED_SNAPSHOT. El middleware conserva HTTP 502, mensaje saneado y ausencia de stack/cuerpo privado. No se alteró el middleware ni se introdujo un nuevo contrato HTTP.

La guarda usa una consulta de identidad por fila: O(1) esperado, sin recorrer el dataset ni memorizar clasificaciones de arrays mutables. Registrar N filas añade O(N) de trabajo; el WeakSet no mantiene referencias fuertes que impidan su recolección. `copyContext` continúa siendo la transferencia explícita: conserva contrato, perfiles, identidad de las filas y linaje. No se modificó su implementación.

La guarda CSV permanece intacta. No se cambiaron numericProfiles, parseMetric/odata-int64, acumulados, diferencias, CSDL, metadata, TTL, single-flight, paginación, configuración, dependencias o EXPORT. Solo se modificaron `src/utils/numeric.js`, `tests/ODataSchema.test.js` y esta sección documental.

### Pruebas antes y después

- Baseline ejecutado: **278/278**, 13 suites.
- Se añadieron ocho casos antes de modificar producción. La suite estructural OData dio **7 fallos y 43 aprobadas** (50 casos): reprodujo aceptación de slice/filter, entradas inseguras/inválidas, arrays mixtos y ausencia del error esperado. La copia explícita con valores válidos ya funcionaba y se conserva.
- Suite completa después: **286/286**, 13 suites, salida 0. No se eliminó ni se modificó la expectativa de ninguna de las 278 pruebas anteriores.
- Cobertura añadida: slice/filter bloqueados; conteos conservados; igualdad de suma entre original y copia autorizada; calidad estricta para Int64 inseguro y texto inválido; rechazo de clones en copyContext; arrays mixtos; reemplazo de fila sin cambiar longitud y append después de una lectura previa; serialización HTTP saneada del nuevo rechazo.
- Complejidad: una prueba con **5.000 filas** cuenta accesos mediante Proxy, sin umbrales de tiempo. Verifica lectura lineal de filas ajenas y de la copia OData autorizada; una copia OData no registrada falla al consumir su primera fila, con menos de tres accesos al array. Una búsqueda completa repetida por métrica no satisface estos límites.
- La suite completa conserva las comprobaciones de CSV, OData, EXPORT, caché, chat y HTTP. No se consultó SAP ni se incorporaron datos reales.

Comandos ejecutados:

```powershell
node node_modules/jest/bin/jest.js tests/ODataSchema.test.js --runInBand --silent --cache=false
node node_modules/jest/bin/jest.js --runInBand --silent --cache=false
git diff --check
git diff --stat
```

`git diff --check` no encontró errores de whitespace; solo se observaron avisos de normalización LF/CRLF. Los cambios quedan locales, sin commit ni push.

### Riesgos residuales

La comprobación protege la fila consumida, no valida anticipadamente todas las filas de un array mixto: una fila ajena puede leerse con el comportamiento legado anterior, pero al consumir una fila OData protegida la agregación lanza error y no devuelve un resultado parcial exitoso. No se extiende la guarda a conteos que no leen métricas.

Una copia profunda pierde identidad de fila y no puede reconocerse con WeakSet. No se registra automáticamente ni se presume válida: requiere revalidación explícita del contrato; copyContext la rechaza. Los registros internos siguen siendo APIs confiables, no una barrera contra código que los invoque deliberadamente con procedencia falsa. La mutabilidad de filas después de publicar y el resto de limitaciones de la sección 9 permanecen sin cambios.
