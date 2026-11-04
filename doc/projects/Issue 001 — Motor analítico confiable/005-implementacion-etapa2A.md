# Issue 001 — Implementación Etapa 2A: integridad numérica CSV

Fecha: 2026-11-04, America/Santiago. Entrega local para revisión, sin commit ni push.

## Resultado

Se implementó interpretación estricta para datasets del CsvProvider local, con perfil explícito por métrica. Los resultados numéricos CSV no se publican cuando las observaciones consultadas contienen valores inválidos, ausentes, ambiguos o acumulados fuera del rango entero seguro. Los conteos siguen disponibles.

La suite final ejecutada aprobó **139/139 pruebas en 9 suites**, incluidas las 68 existentes sin modificaciones. La comparación local contra la interpretación anterior no encontró diferencias en los cálculos comprobados del CSV actual. No se imprimieron ni incorporaron datos de negocio a documentación o fixtures.

Git estaba limpio al iniciar. Se conservaron CommonJS, Express 5 y las dependencias. No se modificaron negociación/paginación OData, credenciales, archivos de datos ni el ciclo de publicación/invalidación de cachés implementado en Etapa 1.

## Archivos y justificación

| Archivo | Modificación |
| --- | --- |
| `src/config/numericProfiles.js` (nuevo) | Configuración provisional explícita: SUMA_NETA y su alias histórico COL_8 usan `csv-integer-comma`. No hay perfil comodín. |
| `src/utils/numeric.js` (nuevo) | Parser con resultados tipados, registro de origen por identidad del dataset, adaptación de consumidores, suma/diferencia segura y DataQualityError. |
| `src/providers/CsvProvider.js` | Registra el array devuelto como CSV con sus perfiles, sin convertir ni modificar las filas. |
| `src/services/DataService.js` | `sumBy` usa lectura estricta y suma verificada; `getInsights` propaga errores de calidad en lugar de convertirlos en contexto textual. |
| `src/services/QueryEngineService.js` | Verifica métricas del conjunto filtrado, total y subtotales por centro. Detecta columna numérica ausente en CSV. |
| `src/services/InsightEngineService.js` | Integra lectura/suma/diferencias seguras en comparaciones de SUMA_NETA y volumen. No omite silenciosamente nulos CSV. |
| `src/services/SummaryService.js` | Integra lectura/suma segura en estadísticas. Evita fabricar ceros y multiplicar sumas enteras seguras por 100 para redondearlas. |
| `src/controllers/CsvController.js` | Resumen CSV no vacío sin columna métrica devuelve error de calidad, en lugar de un ranking vacío aparentemente exitoso. |
| `src/middlewares/errorHandler.js` | Serializa exclusivamente DataQualityError como error estructurado 500, sin datos originales ni stack. Conserva el tratamiento de otros errores. |
| `tests/NumericParser.test.js` (nuevo) | 31 casos del contrato de parser. |
| `tests/CsvNumeric.test.js` (nuevo) | 38 casos de agregación, rango, alias, HTTP y chat. Fixtures sintéticas pasan por CsvProvider/parser CSV reales. |
| `tests/NumericSources.test.js` (nuevo) | 2 casos de aislamiento del perfil respecto a OData y fallback de exportación. |
| Este documento | Evidencia, decisiones y límites de la implementación. |

## Contrato implementado

### Parser

`parseMetric(input, profile)` devuelve uno de estos resultados:

- `{status: 'valid', value}`: Number entero seguro, incluido cero real. Normaliza -0 a 0.
- `{status: 'missing', reason: 'MISSING_VALUE'}`: null, vacío o solo espacios.
- `{status: 'invalid', reason}`: campo ausente, tipo/formato incorrecto, longitud excesiva o entero inseguro.
- `{status: 'ambiguous', reason: 'UNCONFIGURED_PROFILE'}`: no existe un perfil reconocido para el valor no ausente.

El perfil admite signo inicial opcional, dígitos simples o agrupación occidental por comas: primer grupo de uno a tres dígitos y grupos posteriores de exactamente tres. Recorta espacios externos; exige coincidencia de toda la cadena. Rechaza decimales, exponentes, signos finales, paréntesis, separadores internos por espacio/NBSP, moneda, hexadecimal, comillas residuales y agrupaciones irregulares. Admite Number nativo solo si es entero seguro.

La escala es cero. Se limita la cadena recortada a 64 caracteres antes de validar/construir el número. No se eliminan comillas ni sufijos para rescatar prefijos. No se usa BigInt ni aritmética decimal general.

### Origen y perfil

CsvProvider registra los perfiles en un WeakMap cuyo identificador es el array del snapshot. No se usa DATA_SOURCE para decidir cómo convertir una celda. El mismo objeto permanece en la caché de la Etapa 1 y llega a los motores; por eso mantiene su origen aunque el entorno cambie después.

OData y el fallback no se registran como CSV. Se verificó expresamente el fallback con DATA_SOURCE=CSV: sus filas siguen sin perfil local. No se añadieron propiedades a filas, arrays serializados ni respuestas exitosas.

SUMA_NETA y COL_8 tienen perfil explícito. Otras métricas CSV que los resolvers encuentren (por ejemplo VOLUMEN) se bloquean como ambiguas hasta configurar su contrato; no heredan el de SUMA_NETA. Esto evita asumir que columnas diferentes comparten escala o formato.

Los consumidores directos de servicios con arrays sin procedencia conservan comportamiento anterior, por compatibilidad y para no aplicar el perfil CSV a OData. Una copia mediante `slice`, `map`, deserialización o reconstrucción pierde el registro; futuros caminos de transformación deberán transportar/registrar explícitamente el perfil. Los caminos de producción revisados pasan el snapshot original a los consumidores numéricos. Este mecanismo no es una barrera de seguridad frente a código que omita intencionalmente la procedencia.

### Política de calidad

Se implementó política estricta: el primer valor no válido del conjunto numérico consultado interrumpe el cálculo. No se publica subtotal, promedio, percentil, ranking ni ganador con cobertura incompleta. Los códigos distinguen `missing`, `ambiguous` e `invalid`, pero esta etapa no ofrece resultados parciales ni conteos completos de calidad.

Las consultas por fecha/grupo y mes validan las filas que participan en su cálculo; un dato numérico incorrecto fuera del período solicitado no bloquea esa consulta. Una columna métrica inexistente en un dataset CSV no vacío produce MISSING_FIELD. La carga conserva filas inválidas para permitir inspección y conteos: una recarga con strings inválidos puede completarse estructuralmente, pero las consultas numéricas posteriores fallan explícitamente. No se reinterpretó el contrato de recarga de Etapa 1 como validación semántica de todas las métricas.

Dataset vacío mantiene los comportamientos anteriores de cada servicio (por ejemplo sumas vacías o No data); no se impuso una nueva forma HTTP global. Cero real sí es válido y participa en promedio y percentiles. Un dataset con valores ausentes no se trata como dataset vacío.

### Rango y estadística

Cada suma parcial y diferencia absoluta entre totales debe ser un entero seguro. Si se excede el rango, se devuelve UNSAFE_AGGREGATE aun si una cancelación posterior pudiera devolver el total al rango: no se continúa después de perder precisión. Los rankings solo se construyen después de completar las sumas válidas.

Sumas, extremos y percentiles CSV conservan enteros seguros. La suma del resumen ya no se multiplica por 100 para redondear un entero; esto podía modificar un entero válido próximo al límite. Para promedios de magnitud alta, se evita igualmente ese producto inseguro y se utiliza `toFixed(2)` sobre el cociente Number.

**No se promete precisión decimal general:** promedios y porcentajes siguen calculándose con Number y las fórmulas existentes. Se conserva el redondeo habitual a dos decimales del promedio y el percentil discreto `floor(n*p)`, sin interpolación. No se cambian las distintas bases de porcentaje de los dos comparadores mensuales. Estas limitaciones quedan pendientes de una etapa aritmética/estadística explícita.

## Comportamiento HTTP y chat

Respuestas exitosas mantienen sus claves y tipos. Un error de calidad CSV produce, por ejemplo:

```json
{
  "success": false,
  "error": "No se puede calcular una métrica fiable con los datos disponibles.",
  "code": "DATA_QUALITY_ERROR",
  "details": {
    "source": "CSV",
    "status": "invalid",
    "reason": "INVALID_FORMAT"
  }
}
```

Se usa **HTTP 500** porque la petición puede ser correcta y el impedimento está en el dataset/configuración del servidor. No corresponde atribuirlo a parámetros del cliente con 422. Los errores de parámetros existentes conservan su tratamiento. No hay un cambio masivo de contrato: solo respuestas que antes podían aparentar éxito numérico con datos corruptos o incompletos pasan a error estructurado.

El middleware reconoce la clase concreta; no publica strings originales, claves de negocio ni stack para estos errores, tampoco en desarrollo. El diagnóstico contiene el primer código de fallo, no una muestra de la fila.

ChatController ya propaga excepciones mediante `next`; no requirió edición. Se probaron suma por grupo y comparaciones de SUMA_NETA/volumen: ante calidad insuficiente no devuelven `reply` con cifra/ganador, no declaran `exact: true` y no llaman al generador Gemini. La extracción de intención anterior al cálculo sigue existiendo. Un chat válido conserva HTTP 200, valor esperado y `meta.exact` en la consulta de suma.

## Evidencia de pruebas

| Ejecución | Resultado real |
| --- | --- |
| Baseline antes de escribir regresiones | 6 suites, 68/68 aprobadas. |
| Nuevas pruebas antes de modificar producción | 2 suites fallidas: 48 fallos, 3 aprobadas, 51 casos. |
| Primera integración completa | 100 aprobadas, 19 fallidas por mock de filesystem demasiado amplio. |
| Tras acotar mock y ampliar rango/procedencia | 9 suites, 129/129 aprobadas. |
| Tras cubrir columnas ausentes y HTTP/chat adicional | 9 suites, 137/137 aprobadas. |
| Final, incluyendo límite seguro y alias COL_8 | **9 suites, 139/139 aprobadas**, salida 0. |

Los 48 fallos iniciales se separan así: 31 por la API nueva de parser aún inexistente; 17 por comportamiento incorrecto reproducido en agregaciones/HTTP/chat (aceptación de inválidos, ausentes y overflow). Los 3 controles iniciales aprobados verificaban resultados válidos, conteos independientes y compatibilidad del camino sin perfil. Las pruebas añadidas después amplían cobertura; no se presentan como regresiones ejecutadas en rojo antes del cambio.

El fallo intermedio de entorno fue causado por un mock nuevo de `fs.existsSync` que respondía true para cualquier ruta. Al requerir el módulo de configuración, Babel intentó cargar un `babel.config.js` inexistente. Se corrigió el mock para interceptar únicamente la ruta CSV y delegar el resto a fs real. No se agregó configuración Babel ni se modificaron pruebas existentes.

Las pruebas HTTP montan router/middleware reales en Express, escuchan solo en 127.0.0.1 con puerto efímero y cierran el servidor. Los servicios externos están simulados. Se ejecutaron con permiso ampliado para loopback, como en Etapa 1. No se realizó ninguna petición autenticada a SAP ni a Gemini.

Cobertura funcional nueva: formatos válidos y malformados, tipos incorrectos, campo ausente, null/vacío, ambigüedad de perfil, overflow de entrada/acumulados/diferencias, sumas y estadísticas válidas, alias COL_8, filtros temporales, conteos con errores numéricos, errores estructurados y ausencia de datos sensibles, chat válido/inválido, OData y fallback sin perfil local.

## Comparación con el CSV local

Se cargó el archivo local sin modificarlo y se compararon dos caminos: snapshot registrado CSV (estricto) y copia superficial sin registro (que usa exactamente el helper legado). Los valores solo permanecieron en memoria; se imprimió un indicador PASS sin diferencias ni resultados de negocio.

Comparaciones ejecutadas con `assert.deepEqual`:

- Mapas completos de suma por ID_CENTRO, GRUPO_ARTICULOS y CLASE_MOVIMIENTO.
- Todas las estadísticas numéricas de SummaryService.
- Todos los pares de meses distintos de cada año observado, tanto para compareSumaNetaMonths como compareTotalVolumeBetweenMonths, incluyendo ganador, diferencias y porcentajes.
- Tres consultas de fecha/grupo, seleccionadas desde las filas inicial, central y final; comparan el resultado completo, incluidos rankings. No se afirma haber recorrido todas las combinaciones fecha/grupo.

**Resultado: igualdad en todas las comprobaciones.** La comparación se ejecutó antes de añadir las guardas finales de columna ausente, que no afectan el archivo observado con SUMA_NETA presente. Los cambios posteriores incluyeron esas guardas y pruebas adicionales, sin alterar fórmulas del caso válido.

La comparación demuestra paridad bajo el perfil provisional aprobado, no valida el significado de negocio del separador ni la completitud del exportador. La estructura tolerante del parser CSV no se cambió.

## Lógica anterior que permanece y pendientes OData

`src/utils/helpers.js:toNumberSmart()` permanece intacto. Los cinco puntos de conversión de los cuatro servicios ahora llaman a `numeric.readMetric`; este delega al helper anterior cuando el dataset no está registrado como CSV. Por tanto, continúan usando la lógica anterior:

- Sumas/rankings de DataService para OData, export fallback o arrays sin origen registrado.
- Sumas de QueryEngineService para esos mismos orígenes.
- Comparaciones mensuales de SUMA_NETA y volumen para esos orígenes; el volumen conserva la omisión previa de null/vacío en el camino legado.
- Estadísticas de SummaryService para datasets no registrados.

También permanece `Number(countVal)` para @odata.count, fuera del helper. No se cambian fechas, selección heurística de métricas, unidades ni fórmulas porcentuales.

Pendientes: verificar metadata SAP (tipo, precisión, escala, nulabilidad, unidades), representación textual/numérica real, soporte de transporte exacto y contrato propio del fallback de exportación. Recién con esa evidencia se podrá reemplazar la conversión legada sin aplicar el perfil de enteros CSV a datos decimales. La paginación OData continúa fuera de alcance.

Riesgos explícitos: conservar procedencia al transformar arrays; completar perfiles de nuevas métricas; bloqueo conservador por overflow parcial; límites de Number en promedios/porcentajes; ausencia de un reporte exhaustivo de calidad; tratamiento de unidades incompatibles y filas estructuralmente desalineadas todavía no resuelto. No quedaron fallos en las pruebas ejecutadas.

## Reproducción y revisión

Desde la raíz, PowerShell:

```powershell
node node_modules/jest/bin/jest.js --runInBand --cache=false --silent
node node_modules/jest/bin/jest.js --runInBand --cache=false --silent tests/NumericParser.test.js tests/CsvNumeric.test.js tests/NumericSources.test.js
rg -n 'toNumberSmart|numeric\.' src/services src/utils/numeric.js
git diff --check
git diff --stat
git status --short
```

El comando completo final ejecutado produjo 139 pruebas aprobadas. `git diff --check` no informó problemas. Se revisó el diff de los componentes afectados y se comprobó ausencia de cambios en helpers.js, QueryService, DatasetProfileService, manifests, lockfile y las seis suites anteriores. Los archivos nuevos se revisaron como parte de esta entrega; no aparecen en `git diff --stat` hasta agregarlos al índice, acción que no se realizó.

No se requirió un cambio incompatible amplio de contratos. Se aplicó únicamente el error estructurado autorizado para resultados numéricos que no pueden calcularse de manera fiable. Cambios locales listos para revisión, sin commit ni push.
