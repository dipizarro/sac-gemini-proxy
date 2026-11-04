# Issue 001 — Implementación Etapa 3A

Fecha: 2026-11-04. Rama: issue-motor-analitico-confiable. Entrega local, sin commit ni push.

## Resultado

Se valida la estructura completa CSV antes de crear objetos y se comprueba el contexto del snapshot antes de publicar datos provenientes del provider CSV real. Encabezados duplicados, colisiones de normalización, filas cortas/largas, comillas inválidas y campos requeridos ausentes provocan errores estructurados. Una recarga incompatible conserva el snapshot vigente y sus derivados.

Resultado final: **183/183 pruebas aprobadas, 11 suites**. El archivo local pasó validación estructural completa: nueve columnas, seis roles requeridos y COL_2 conservado. No se divulgaron valores reales ni se copiaron datos a fixtures.

## Defectos corregidos y arquitectura

- CsvProvider ya no mapea registros con ancho tolerante directamente a objetos. Delega el reconocimiento y validación a CsvSchemaService.
- Se parsea el archivo como registros CSV completos, por lo que los campos multilínea entrecomillados no se confunden con líneas de encabezado. Las comillas se validan estrictamente.
- El reconocimiento exige exactamente un registro con una celda cuyo contenido recortado sea MATERIAL1. No acepta coincidencias por substring. Múltiples candidatos se rechazan como layout ambiguo.
- En encabezado doble reconocido por SUMA_NETA/Indicadores en la fila superior, se exigen anchos iguales, se rellenan huecos y se rechaza conflicto del campo SUMA_NETA con otro nombre inferior.
- Los nombres finales normalizados deben ser únicos, incluidos nombres COL_n generados: se evita sobrescritura de propiedades.
- Cada fila debe tener exactamente el ancho del header, antes de recortar relleno o construir objetos. No se truncan, rellenan ni omiten filas defectuosas.

`relax_column_count:true` permanece exclusivamente en la lectura como arrays para permitir preámbulos de ancho distinto. **No implica aceptación de filas de datos de ancho variable**: cada una se compara contra el encabezado antes de mapear; cualquier diferencia rechaza el candidato completo. Se conserva el contenido de las celdas, incluidos espacios y saltos de línea, sin recortes destructivos.

## Contrato explícito

`src/config/csvContract.js` declara revisión `movmat-csv-1` y seis roles obligatorios: MATERIAL1, FECHA, ID_CENTRO, GRUPO_ARTICULOS, CLASE_MOVIMIENTO y SUMA_NETA.

Columnas adicionales únicas se conservan. Su orden puede cambiar; el mapeo se hace por nombre. Las columnas anónimas interiores reciben COL_n y conservan sus valores; COL_2 no se descarta por carecer de nombre.

Se declaran layouts con cero, una o dos columnas iniciales de relleno. Solo se eliminan si **todas** las filas tienen vacías esas posiciones (tras recortar espacios). Otros anchos de relleno requieren cambio explícito del contrato. No se descartan columnas iniciales que contengan datos.

El layout histórico de alias exige el nombre literal COL_8 en el encabezado y ausencia de SUMA_NETA. No se deduce a partir del índice 8 ni de un nombre generado para un hueco. En ese layout se conserva COL_8 y se añade la propiedad canónica SUMA_NETA con el mismo contenido, para que todos los consumidores resuelvan la métrica sin heurísticas posicionales. Cuando SUMA_NETA está presente no se sustituye por COL_8. Los perfiles numéricos aprobados permanecen intactos.

## Contexto y publicación

El registro de numeric.js incorpora contexto CSV inmutable: origen, revisión, columnas, roles e identidad UUID del snapshot. Los perfiles numéricos siguen en el registro existente. `registerValidatedCsv` recibe el resultado de validación estructural; `assertCsvContext` comprueba presencia, columnas y tipos textuales antes de publicar.

`copyCsvContext(original, rows)` permite copias o filtros que reutilicen referencias de filas del snapshot original, con nuevo snapshotId. Verifica que el original siga teniendo la forma validada y rechaza filas ajenas. No autoriza automáticamente map de objetos, cambios de columnas ni conversiones de tipos. Una copia superficial no registrada con filas CSV conocidas se rechaza al leer métricas, evitando la caída silenciosa al conversor legado.

DataService comprueba contexto cuando la fuente es la instancia CsvProvider, antes de entregar el candidato a publicación. Las rutas directas del provider reciben snapshots validados desde el propio provider. Los dobles de prueba genéricos y arrays de servicios sin procedencia siguen admitidos para conservar compatibilidad; no se usa DATA_SOURCE para etiquetar indiscriminadamente cualquier array.

La invalidación/publicación de Etapa 1 no cambia. SchemaError se propaga y excluye explícitamente el fallback EXPORT. getInsights también propaga el error estructural. Al fallar una recarga no se cambia MOVMAT_DATA, MOVMAT_INDEX_V1 ni MOVMAT_PROFILE_V1, ni se extiende su TTL. Una carga válida sigue invalidando derivados al publicar. Un snapshot vacío con encabezado válido conserva contexto y puede publicarse.

## Errores

SchemaError produce HTTP 500 con `success:false`, mensaje genérico, `code:SCHEMA_CONTRACT_MISMATCH` y `details:{source:'CSV',reason}`. Razones implementadas: MISSING_REQUIRED_COLUMN, DUPLICATE_COLUMN, INVALID_ROW_STRUCTURE, INCOMPATIBLE_COLUMN_LAYOUT y UNVALIDATED_SNAPSHOT.

El middleware devuelve estos errores sin filas, valores, rutas, cuerpos originales ni stack. El estado 500 corresponde a estructura de la fuente del servidor, no a un parámetro inválido del cliente. No se alteran respuestas exitosas generales ni errores numéricos/OData existentes. El alias explícito añade la propiedad canónica solo al layout que lo declara.

Estructura y calidad siguen separadas: campo físicamente ausente en una fila causa INVALID_ROW_STRUCTURE; celda vacía presente en la métrica mantiene el tratamiento numérico de ausencia aprobado. Valores numéricos inválidos no se reinterpretan como fallos de esquema ni eliminan movimientos.

## Archivos modificados

| Archivo | Motivo |
| --- | --- |
| `src/config/csvContract.js` (nuevo) | Contrato y layouts explícitos. |
| `src/services/CsvSchemaService.js` (nuevo) | Reconocimiento, validación previa a objetos y SchemaError. |
| `src/providers/CsvProvider.js` | Sustituye mapeo tolerante por servicio estructural y registro validado. |
| `src/utils/numeric.js` | Contexto CSV y transferencia explícita; protección contra copias superficiales sin contexto. |
| `src/services/DataService.js` | Última comprobación del contexto, exclusión de fallback y propagación. |
| `src/middlewares/errorHandler.js` | Serialización saneada del error estructural. |
| `tests/CsvSchema.test.js` (nuevo) | 13 casos estructurales, contexto, caché y alias. |
| `tests/CsvNumeric.test.js` | Fixture completa incluye CLASE_MOVIMIENTO; conserva las aserciones numéricas existentes. |
| `tests/ProviderLifecycle.test.js` | Fixtures simples/dobles incorporan GRUPO_ARTICULOS y CLASE_MOVIMIENTO; ajusta el objeto esperado para esas columnas. |

La expansión de fixtures es intencional: antes representaban cargas parciales de cuatro/cinco columnas, ahora incompatibles con los seis campos obligatorios aprobados. No se eliminaron casos ni debilitaron aserciones para ocultar regresiones. No se modificaron dependencias, credenciales, perfiles numéricos, paginación ni lectura de metadata OData.

## Pruebas antes y después

1. Baseline ejecutado antes de cambios: **170/170**, 10 suites.
2. Primera suite estructural antes de producción: **8 fallos y 2 aprobadas**, 10 casos. Reprodujo truncamiento, campos faltantes, duplicados/colisiones, nombre requerido cambiado, encabezado doble incompatible, error de comillas no saneado y copia sin contexto aceptada.
3. Primera integración: **180/180**, 11 suites.
4. Con protección de caché y relleno/COL_2: **182/182**.
5. Final con alias explícito y propagación: **183/183**, 11 suites, salida 0.

Los tres casos añadidos después amplían cobertura; no se presentan como ejecutados en rojo antes del cambio. Las pruebas de caché verifican identidad del dataset/índice/perfil tras fallo, ausencia de exportación en carga fría incompatible y derivados ausentes al publicar datos válidos. Las suites anteriores conservan cobertura de TTL y recarga.

La lectura del CSV local se ejecutó sin modificaciones: `assertCsvContext` aprobó el snapshot, indicó nueve columnas, seis roles y presencia de COL_2 en todas las filas. Solo se imprimieron esos indicadores. No se afirma aquí una nueva comparación exhaustiva de todas las métricas reales: la comprobación local de esta etapa es estructural.

Comandos finales ejecutados:

```powershell
node node_modules/jest/bin/jest.js --runInBand --silent --cache=false
git diff --check
git diff --stat
```

Las pruebas HTTP preexistentes requieren loopback y se ejecutaron con permiso ampliado para localhost. No se consultó SAP. `git diff --check` no informó errores.

## Riesgos residuales y Etapa 3B

- Reconocimiento conservador: una celda de datos exactamente MATERIAL1 genera varios candidatos y rechaza el archivo, en vez de adivinar encabezado. Nuevos preámbulos/layouts requieren pruebas y ampliación explícita.
- No se puede detectar intercambio de dos campos de igual ancho/tipo solo mediante estructura. Semántica de fechas, unidades y nombres parecidos en heurísticas de consumidores requiere trabajo separado.
- Las filas permanecen mutables por compatibilidad. La validación antes de publicar no congela datos. Una copia profunda ajena pierde WeakMap y no puede reconocerse por identidad de filas; no hay tal transformación en los caminos CSV productivos revisados. Nuevas transformaciones deben usar contexto explícito o revalidar desde el origen. No se afirma protección universal de arrays arbitrarios.
- La transferencia implementada admite referencias de filas, no clones de objetos ni cambios de tipos. Ampliarla requiere contrato de transformación, no registro automático.
- Los errores de lectura de archivo anteriores al parseo conservan el tratamiento de carga existente; esta etapa sanea errores estructurales, no refactoriza todo error de filesystem.
- Pendiente 3B: metadata/EntityType OData, compatibilidad de esquemas entre cargas, TTL/ETag de metadata, versión semántica y mecanismo de lectura CSDL aprobado. No se implementó ni añadió una dependencia XML.
- EXPORT mantiene su contrato pendiente y su bloqueo numérico aprobado. No se ejecutaron jobs ni se asumió que su layout coincida con CSV local.

Cambios locales listos para revisión; sin commit ni push.

## Correcciones de revisión de df9ca64 — 2026-11-04

Esta sección sustituye la aceptación del alias COL_8 descrita en la entrega original. Estado inicial de Git limpio; cambios locales, sin commit ni push.

### Contrato del alias

No se encontró una definición verificable de un layout histórico aprobado que permita identificar COL_8 como SUMA_NETA. El nombre literal por sí solo no constituye esa evidencia. Se elimina `metricAlias` y la síntesis de SUMA_NETA; la revisión del contrato pasa a `movmat-csv-2`. Si falta la columna canónica, incluso cuando existe COL_8, la carga falla con `SCHEMA_CONTRACT_MISMATCH / MISSING_REQUIRED_COLUMN` (HTTP 500 existente). Para habilitar un alias futuro será necesaria evidencia independiente del significado del layout y pruebas específicas, no una inferencia por nombre o posición.

COL_8 se conserva como columna adicional cuando existe SUMA_NETA. No se cambian los perfiles numéricos aprobados. La recuperación de SUMA_NETA desde el encabezado superior válido continúa funcionando.

### Copia y lectura

`copyCsvContext` valida el original y construye un `Set` de referencias. La pertenencia de las M filas de destino deja de requerir M búsquedas lineales sobre las N originales: cuesta O(N + M), además de la validación estructural O(N × columnas), con memoria auxiliar O(N). Se conserva identidad estricta: un objeto clonado con los mismos campos sigue siendo rechazado. No se cambia la generación de identidad del snapshot ni la publicación de caché.

`readMetric` consulta directamente `csvRows.has(row)` cuando el array carece de registro numérico. La detección cuesta O(1) por fila procesada y no memoriza clasificaciones de arrays mutables. Una copia superficial sin contexto falla al consumir una fila CSV. En un array mixto, una fila ajena puede leerse con el comportamiento legado existente; al consumir una fila CSV conocida se lanza `UNVALIDATED_SNAPSHOT` y la agregación no devuelve un resultado parcial exitoso. La comprobación no es una validación anticipada de filas que nunca se consumen. Una fila CSV incorporada después de lecturas anteriores también se rechaza. Las limitaciones sobre copias profundas y mutabilidad descritas anteriormente siguen vigentes.

### Archivos de esta corrección

- `src/config/csvContract.js`: elimina alias sin evidencia e identifica la revisión del contrato.
- `src/services/CsvSchemaService.js`: exige todos los nombres canónicos y elimina la propiedad sintetizada.
- `src/utils/numeric.js`: pertenencia mediante Set y comprobación directa de identidad al leer métricas.
- `tests/CsvSchema.test.js`: regresiones de alias, complejidad, identidad y arrays mixtos modificados después de su primera lectura.
- Este documento: evidencia y alcance de las correcciones.

### Pruebas ejecutadas

1. Baseline: **183/183 aprobadas**, 11 suites.
2. Antes de modificar producción: suite CSV con **3 fallos y 14 aprobadas**. Se reprodujeron la aceptación incorrecta de COL_8 sin SUMA_NETA, 5.150 accesos a elementos al copiar 100 filas y 10.100 accesos al leer 100 métricas de un array sin contexto. Las pruebas cuentan accesos mediante Proxy, sin depender de tiempos de máquina.
3. Después: suite completa **187/187 aprobadas**, 11 suites, salida 0, incluidas integración HTTP, OData, caché y contratos numéricos anteriores. Se conservan los 183 casos originales, con cambio intencional de la expectativa del caso del alias: ahora exige rechazo por la decisión explícita de revisión. Se añaden cuatro casos; no se elimina ninguna prueba.
4. Lectura del CSV real local, sin modificarlo: `assertCsvContext` aprobó revisión `movmat-csv-2`, nueve columnas, los seis roles y COL_2 conservado. Solo se imprimieron indicadores estructurales; no se publicaron valores de negocio. No se afirma una comparación exhaustiva de cálculos del dataset real.
5. `git diff --check`: salida 0; solo avisos de normalización LF/CRLF de Git. Revisión del diff limitada a los cinco archivos anteriores.

Comandos de pruebas:

```powershell
node node_modules/jest/bin/jest.js tests/CsvSchema.test.js --runInBand --silent --cache=false
node node_modules/jest/bin/jest.js --runInBand --silent --cache=false
git diff --check
git diff --stat
```

La suite completa se ejecutó con permiso para loopback local. No se consultó SAP ni se modificaron OData, paginación, dependencias, TTL o coherencia de caché. Los pendientes de la Etapa 3B permanecen sin cambios.

### Ajuste final de consistencia tras revisión de 5c170eb

Se elimina COL_8 de `src/config/numericProfiles.js`: no existe un contrato numérico independiente aprobado para esa columna. Esta decisión sustituye la conservación de ese perfil descrita en las entregas anteriores. SUMA_NETA sigue siendo obligatoria y es la única métrica autorizada por la configuración CSV. COL_8 puede conservar contenido adicional, pero su lectura como métrica produce `DATA_QUALITY_ERROR / UNCONFIGURED_PROFILE` aun cuando su texto parezca un entero válido.

Se revisaron todas las referencias a COL_8 en producción. `SummaryService.buildRichSummary`, `DataService.getInsights` y `CsvController.getSummary` seleccionan ahora exactamente SUMA_NETA para datasets registrados como CSV, incluidos snapshots validados. No seleccionan COL_8 ni nombres que simplemente contengan SUMA_NETA. Si se elimina la métrica canónica después de validar el snapshot, el cálculo falla con `DATA_QUALITY_ERROR / MISSING_FIELD`; el endpoint devuelve el HTTP 500 estructurado existente. La carga inicial sin SUMA_NETA continúa siendo rechazada por el contrato estructural. Las ramas de selección anteriores se conservan para otros orígenes y arrays sin procedencia; no se modifica el contrato OData ni EXPORT.

Archivos de este ajuste: `src/config/numericProfiles.js`, `src/services/SummaryService.js`, `src/services/DataService.js`, `src/controllers/CsvController.js`, `tests/CsvNumeric.test.js` y este documento. No cambia caché, paginación, dependencias ni configuración privada.

Validación realizada:

- Git estaba limpio al comenzar. Baseline: **187/187 pruebas**, 11 suites.
- Antes de modificar producción, `CsvNumeric.test.js`: **3 fallos y 37 aprobadas**. El caso histórico aceptaba la sustitución; el nuevo caso de perfil esperaba UNCONFIGURED_PROFILE pero recibía INVALID_FORMAT; el endpoint devolvía HTTP 200 en lugar del rechazo esperado.
- Cambio intencional de expectativa: la prueba histórica del alias ahora exige MISSING_FIELD al eliminar SUMA_NETA aunque COL_8 exista. No se elimina el caso.
- Dos casos nuevos verifican cálculo canónico (990 con valores sintéticos 1.000 y -10), preservación de COL_8 con texto diferente, bloqueo de su uso numérico explícito, respuesta HTTP correcta y rechazo del fallback en `getInsights`.
- Suite completa final: **189/189 pruebas aprobadas, 11 suites**, salida 0. Incluye las suites CSV/OData/EXPORT, HTTP y caché existentes. Se ejecutó `node node_modules/jest/bin/jest.js --runInBand --silent --cache=false`; la reproducción previa usó el mismo comando limitado a `tests/CsvNumeric.test.js`.
- `git diff --check` y revisión del diff final: sin errores de whitespace ni modificaciones ajenas al ajuste (Git advierte normalización LF/CRLF).

No se consultó SAP ni se utilizaron datos de negocio en las pruebas. No se realizó commit ni push. La Etapa 3A queda preparada para revisión de cierre; permanecen los pendientes de la Etapa 3B ya documentados.
