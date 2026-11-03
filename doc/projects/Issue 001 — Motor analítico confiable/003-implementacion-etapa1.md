# Issue 001 — Implementación Etapa 1

Fecha: 2026-11-03 (America/Santiago).

## Resultado y alcance

Implementado el ciclo asíncrono de carga mediante los providers existentes, la coherencia entre dataset/índice/perfil y la selección de métrica del resumen HTTP. Cambios locales, sin commit ni push.

Se conservaron CommonJS, Express 5, las dependencias y las pruebas preexistentes. No se modificaron `toNumberSmart()`, paginación OData, archivos de credenciales ni datos locales. Todas las fixtures nuevas son sintéticas.

## Estado inicial

`git status --short` no mostró cambios al comenzar esta etapa. Se leyó `002-entrega.txt` como referencia y no se modificó. No se encontraron instrucciones AGENTS.md en la búsqueda del repositorio ni en los directorios superiores comprobados.

Baseline ejecutado antes de escribir pruebas: 3 suites, 39 pruebas aprobadas, código de salida 0. El mensaje `API Error` del test de IntentRouter corresponde al escenario deliberado de error del mock de Gemini, no a una prueba fallida.

## Diagnóstico y archivos modificados

| Archivo | Cambio y justificación |
| --- | --- |
| `src/services/DataService.js` | Agrega `reloadRows()`, separa obtención de publicación, valida que el resultado sea un array de registros y centraliza invalidación de derivados. Comparte cargas en frío, serializa recargas y evita publicación tardía tras `clearCache()`. |
| `src/services/QueryService.js` | `_getIndex()` y `countDistinctCentersByDate()` son asíncronos. Consultan primero el dataset para detectar vencimiento, verifican identidad de filas y evitan publicar índices de snapshots anteriores. |
| `src/services/DatasetProfileService.js` | Reutiliza perfil solo para las mismas filas; únicamente publica perfiles correspondientes al dataset actualmente cacheado. Limpia también la referencia de identidad al invalidar. |
| `src/controllers/CsvController.js` | Elimina las cuatro llamadas al método inexistente, espera QueryService, obtiene la ruta desde CsvProvider y prioriza SUMA_NETA sobre COL_8. Delega publicación e invalidación al servicio. |
| `tests/DataLifecycle.test.js` | 15 pruebas del ciclo de carga, TTL, fallo, derivados, concurrencia, arrays vacíos y fallback. |
| `tests/CsvEndpoints.test.js` | 11 pruebas HTTP locales sobre el router y middleware reales de Express, con providers simulados. |
| `tests/ProviderLifecycle.test.js` | 3 pruebas de integración con factory real, parser CSV real usando buffers sintéticos y provider OData simulado. |
| Este documento | Evidencia, decisiones y limitaciones para revisión. |

La quinta referencia obsoleta estaba en QueryService. La búsqueda final en `src` no encuentra `loadMovMatCsv`. Su único consumidor de consulta por fecha en CsvController ahora usa `await`.

## Decisiones técnicas

### Publicación y versiones

Se conserva `MOVMAT_DATA` como array y las formas de los valores existentes en `MOVMAT_INDEX_V1` y `MOVMAT_PROFILE_V1`; no se introducen envoltorios ni un nuevo formato de caché.

La identidad del array representa el snapshot. Los providers actuales crean arrays al cargar. QueryService y DatasetProfileService conservan la identidad de las filas con las que construyeron sus derivados. No deben mutarse in situ los snapshots publicados.

La publicación valida primero el resultado y después invalida ambos derivados y sustituye datos en un bloque síncrono, sin `await` intermedio. Los derivados se reconstruyen bajo demanda. Una consulta que ya obtuvo un snapshot anterior puede terminar con él, pero no puede reemplazar los derivados del snapshot actual.

QueryService obtiene filas antes de leer el índice: un índice con TTL todavía vigente no evita renovar un dataset vencido. Se mantienen TTL de 24 horas para provider y 10 minutos para fallback de exportación. Un array vacío es una carga válida y se cachea, evitando recargas repetidas; `null`, objetos sueltos y arrays con registros inválidos se rechazan.

### Concurrencia y errores

Lectores simultáneos con caché fría comparten una promesa. Cada recarga explícita espera cualquier carga anterior y después consulta al provider, por lo que no publica resultados fuera de orden. Mientras la recarga está pendiente, las lecturas pueden seguir usando el dataset vigente.

Un contador de generación impide que una carga iniciada antes de `clearCache()` repueble la caché después de esa invalidación. No cancela la petición I/O subyacente; evita su publicación.

La recarga explícita no borra previamente datos ni derivados. Si falla el provider o la validación, los valores previos se conservan. No usa fallback de exportación para encubrir el fallo de una recarga solicitada. La carga normal en frío mantiene el fallback existente si está configurado. También conserva el error HTTP 500 mediante el middleware existente.

### Endpoints y selección de métrica

- `/csv/reload`, `/csv/profile` y `/csv/preview` utilizan carga forzada del provider seleccionado por la factory. Se conserva su intención previa de consultar la fuente, aunque ahora publican un snapshot coherente compartido. En modo ODATA consultan ese provider; no fuerzan CSV por el nombre de la ruta.
- `/csv/summary` utiliza el snapshot cacheado o carga en frío. Prefiere la columna exacta `SUMA_NETA`; únicamente usa `COL_8` cuando existe en el esquema de la primera fila y no existe `SUMA_NETA`. No hace fallback por un valor cero o nulo ni cambia la conversión numérica.
- Sin ambas columnas, devuelve `topCentros: []`, manteniendo HTTP 200 y las mismas claves. Esta corrección evita representar una métrica inexistente como sumas cero. Es un cambio de contenido documentado, no de estructura HTTP.
- `/csv/status` informa la ruta del archivo CSV propiedad de CsvProvider. La parte `cache` sigue describiendo el dataset compartido, que puede provenir de OData.
- `/csv/query/distinct-centers` espera el resultado y conserva las formas de respuesta exitosa y el error 400 por fecha ausente.
- El mensaje histórico `CSV reloaded and cached` se conserva para compatibilidad, incluso si la factory selecciona OData.

No se alteraron routes, server, motores analíticos, SummaryService ni endpoints de exportación independientes.

## Pruebas ejecutadas y evidencia

| Momento | Resultado real |
| --- | --- |
| Baseline antes de escribir regresiones | 3 suites, 39/39 aprobadas. |
| Primer intento de las 18 regresiones dentro del sandbox | 17 fallos y 1 aprobada; las 9 HTTP fallaron por `connect EACCES 127.0.0.1`, no por aserciones de aplicación. |
| Regresiones antes de corregir, con ejecución HTTP local permitida | 2 suites fallidas; 16 fallos y 2 aprobadas. |
| Primera ejecución completa tras la corrección | 5 suites, 57/57 aprobadas. |
| Final, tras ampliar concurrencia y providers | 6 suites, 68/68 aprobadas; código de salida 0. |

Los 16 fallos previos fueron:

- Unitarios (8): consulta fría con método inexistente; dos escenarios sin API de recarga; uso de índice tras vencer datos; índice sobreviviente a clearCache; carga fría duplicada; vacío no cacheado; perfil reutilizado para otro snapshot.
- HTTP (8): summary/profile/preview/distinct-centers devolvían 500 en frío; prioridad incorrecta de COL_8; sumas cero inventadas sin métrica; reload no devolvía éxito; status no incluía ruta.

Los dos controles que ya pasaban eran fallback de exportación en frío y resumen con COL_8 existente. Las 11 pruebas añadidas después de la primera corrección amplían concurrencia, respuestas inválidas, HTTP y providers: no se presentan como pruebas rojas ejecutadas contra la versión anterior.

La integración HTTP usa el router y middleware reales en un servidor efímero enlazado exclusivamente a `127.0.0.1`, con cliente `node:http`; se cierra al terminar. Se probaron status, summary, profile, preview, distinct-centers y reload, incluidos fallo de recarga y actualización conjunta del perfil temporal. No se arrancó `server.js` ni se invocó Gemini/Datasphere real. Los tests CSV interceptan únicamente la lectura del archivo del provider para proporcionar buffers sintéticos.

La restricción de loopback del sandbox se resolvió ejecutando Jest con permiso ampliado para estas pruebas locales. No fue necesario cambiar código de aplicación para el entorno.

### Comandos reproducibles

Desde la raíz del repositorio:

```powershell
# Baseline original, también utilizable para comprobar que se conserva
node node_modules/jest/bin/jest.js --runInBand --cache=false tests/IntentRouterService.test.js tests/InsightEngineService.test.js tests/QueryEngineService.test.js

# Regresiones iniciales (ahora deben pasar)
node node_modules/jest/bin/jest.js --runInBand --cache=false --silent tests/DataLifecycle.test.js tests/CsvEndpoints.test.js

# Suite final ejecutada: 68 pruebas
node node_modules/jest/bin/jest.js --runInBand --cache=false --silent

git diff --check
git diff --stat
git status --short
rg -n 'loadMovMatCsv|QueryService.countDistinctCentersByDate' src
```

Se utiliza el binario directo de Jest para evitar la ambigüedad de traspaso de flags de npm observada durante el diagnóstico. `--silent` oculta logs esperados, no omite pruebas ni aserciones. La revisión del diff no mostró cambios ajenos a los cuatro componentes de producción afectados; las pruebas existentes, manifests y lockfile permanecen intactos.

## Limitaciones y Etapa 2

No quedaron fallos en las pruebas ejecutadas de esta etapa. Esto no equivale a validar un tenant SAP real ni la integridad semántica completa de sus datos.

- Continúa el defecto conocido de coma decimal de `toNumberSmart()`, expresamente fuera del alcance. Los tests de esta etapa usan enteros inequívocos.
- Continúan pendientes el contrato de formatos numéricos ambiguos, negativos alternativos, nulos y valores inválidos, y sus efectos en promedios/rankings.
- No se implementó paginación de consultas OData filtradas ni se verificó completitud de respuestas reales.
- No se cambió la tolerancia a columnas desalineadas del parser ni la diferencia de encabezados entre CSV y export fallback. La validación nueva comprueba estructura de registros, no esquema de negocio ni contenido numérico.
- Se conserva la selección actual de DATA_SOURCE y su diferencia de normalización con QueryStrategyResolver. No cambiar la fuente dinámicamente en un proceso con caché sin invalidar o recargar.
- La coherencia es por proceso y snapshot, no distribuida entre réplicas. Los arrays publicados deben tratarse como inmutables; no se introdujo copia o congelación de datasets grandes.
- `clearCache()` es una invalidación explícita, no una recarga transaccional. Tampoco se añadió disponibilidad indefinida de datos vencidos: si vence el TTL y no puede cargarse la fuente/fallback, la lectura falla. Una recarga fallida conserva entradas previas con su TTL original, sin extenderlo.
- Las recargas explícitas concurrentes se serializan y cada una accede a la fuente. No se añadieron cancelación, timeout ni limitación de solicitudes.
- Preview/profile siguen implicando acceso forzado a la fuente; pueden ser costosos en OData. Ahora publican e invalidan derivados al completarse, para mantener coherencia.

Entrega preparada para revisión local; sin commit ni push.
