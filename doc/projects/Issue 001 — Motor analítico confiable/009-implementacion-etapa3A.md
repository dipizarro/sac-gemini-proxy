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
