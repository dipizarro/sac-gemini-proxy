# Issue 001 — Etapa 2: contrato de integridad numérica

Fecha: 2026-11-03, America/Santiago. Estado: propuesta para aprobación; sin implementación.

## 1. Recomendación

Sustituir la inferencia por celda por un contrato explícito por origen y métrica. Separar interpretación, calidad y cálculo: un cero válido, un valor ausente, un formato inválido y un valor ambiguo no son equivalentes.

Para el CSV local, la evidencia es consistente con coma como agrupador de miles y valores enteros. Recomiendo un perfil específico de enteros agrupados por coma para esta exportación, sujeto a confirmación del responsable del origen. No generalizarlo a otros CSV ni a OData. Para OData, obtener tipo, precisión y escala del modelo y verificar la representación del transporte antes de activar un perfil decimal canónico.

Este documento solo propone cambios. No modifica código, pruebas, providers, contratos HTTP ni soluciones de la Etapa 1. Git estaba limpio al comenzar. No se añadieron dependencias ni se consultó el tenant SAP.

## 2. Evidencia local y límites de confidencialidad

Se ejecutó `CsvProvider.loadData()` sobre el CSV local configurado por el proyecto. La lectura fue completa, no una muestra. Se clasificó exclusivamente SUMA_NETA; las dimensiones con apariencia numérica no se interpretaron como métricas. No se publican valores reales, identificadores, fechas de movimientos, sumas, mínimos, máximos ni rankings del negocio. Los ejemplos del documento son sintéticos.

El provider detectó encabezado doble, sin columnas iniciales eliminadas. La clasificación se realizó sobre las cadenas entregadas por el parser; no certifica que la configuración tolerante del parser no haya descartado campos del archivo original.

| Patrón de SUMA_NETA | Observaciones técnicas |
| --- | ---: |
| Filas examinadas | 32.203 |
| Enteros sin separador, con signo opcional | 71 |
| Coinciden con agrupación occidental por coma: `[+-]?\d{1,3}(,\d{3})+` | 32.132 |
| Una sola coma, exactamente tres dígitos finales | 31.834 |
| Varias comas, todos los grupos posteriores de tres dígitos | 298 |
| Contienen punto | 0 |
| Coma única con longitud decimal distinta de tres | 0 |
| Signo menos inicial | 193 |
| Signo más inicial, menos final o paréntesis | 0 |
| Nulos/ausentes o cadenas vacías | 0 |
| Espacios, incluidos los detectados por `\s` | 0 |
| Fuera de las gramáticas de entero simple o agrupado anteriores | 0 |
| Prefijo de ceros antes de otro dígito | 0 |
| Enteros fuera de rango seguro al quitar comas | 0 |

Las categorías de signo y separadores se solapan; no deben sumarse. Bajo la interpretación de comas como agrupación, también se comprobó con BigInt que todos los acumulados prefijos de la suma global permanecen en el rango seguro de Number. Solo se registró ese booleano, no los acumulados. Esto no demuestra la seguridad de toda futura agregación, subconjunto o exportación.

**Hecho:** todos los valores observados admiten una interpretación de entero con agrupación occidental. **Inferencia fuerte:** las 298 cadenas con varias comas apoyan que esa sea la convención uniforme del archivo. **No demostrado:** que cada cadena de una sola coma represente miles; el mismo texto puede representar tres decimales en otro contrato. No hay metadatos locales de formato que cierren esa ambigüedad. No se encontraron decimales inequívocos, nulos o inválidos en esta columna; su ausencia aquí no elimina la necesidad de soportarlos en otros orígenes.

## 3. Función actual y consumidores

Referencias relativas a la raíz del repositorio; líneas observadas en esta revisión.

`src/utils/helpers.js:11`, `toNumberSmart(x)`:

- Líneas 12–13: null, undefined y vacío se convierten en cero; el resto se transforma a string, se recortan extremos y se eliminan todas las comillas. Esto admite coerciones de arrays y oculta caracteres inválidos.
- Líneas 20–32: elimina comas o puntos según conteo y posición, sin validar agrupaciones.
- Líneas 33–42: la rama que intenta distinguir coma decimal es inalcanzable: el primer `if` ya captura `commaCount === 1 && dotCount === 0`.
- Líneas 45–46: `parseFloat` acepta prefijos y descarta sufijos; todo resultado no finito termina como cero. No distingue error de sintaxis, rango ni falta de dato.

La búsqueda completa encontró cinco lugares de invocación en cuatro servicios:

| Consumidor | Operación e impacto |
| --- | --- |
| `src/services/DataService.js:12`, `sumBy`, llamada en línea 15 | Sumas por clave; `topN` ordena descendente. Lo usan `/csv/summary` (`CsvController.js:61`) y `getInsights` (`DataService.js:43`). No se encontró una llamada externa a `getInsights` en `src`. |
| `src/services/QueryEngineService.js:42`, `sumSumaNetaByGroupAndDate`, llamada en línea 94 | Total, sumas y ranking por centro. Cuenta filas y centros incluso cuando la métrica acaba convertida a cero. Usado en `/csv/query/suma-neta` y `/chat`. |
| `src/services/InsightEngineService.js:304`, `compareSumaNetaMonths`, llamada en línea 326 | Totales mensuales, ganador, diferencia absoluta y porcentaje. Usado en `/csv/insights/compare-sumaneta` y `/chat`. |
| `src/services/InsightEngineService.js:491`, `totalVolumeByMonth`, llamada en línea 508 | Omite null, undefined y vacío antes del helper; el resto sigue sus heurísticas. Alimenta `compareTotalVolumeBetweenMonths` y `/chat`, para SUMA_NETA u otra columna resuelta por `resolveVolumeMetric`. |
| `src/services/SummaryService.js:11`, `buildRichSummary`, llamada en línea 31 | Suma, promedio, mínimo, máximo, p50 y p90 usados por `/csv/profile`. El filtro `!isNaN(val)` nunca excluye las conversiones inválidas porque el helper devuelve cero. |

Los conteos de movimientos, centros distintos, materiales y rankings por frecuencia no usan este helper: no deben cambiar al corregir métricas. `@odata.count` se convierte con `Number` por otro camino (`ODataProvider.js:175`); no es una llamada a toNumberSmart y requiere una política de enteros aparte.

Los valores del CSV permanecen como strings (`CsvProvider.js:94`). OData normaliza nombres, pero conserva los valores (`ODataProvider.js:16–27`). El fallback de exportación de `DataService._loadRows` también produce strings; no hereda automáticamente el contrato JSON de OData por provenir del mismo sistema.

## 4. Defectos reproducidos con datos sintéticos

Se ejecutaron scripts Node directamente contra las funciones actuales; no se escribieron tests ni se cambió implementación.

| Entrada | Salida actual | Diagnóstico |
| --- | --- | --- |
| `"1,50"`, `"-1,50"` | 150, -150 | Coma decimal multiplicada por 100. |
| `"1,234"`, `"1.234"` | 1234, 1.234 | Dos convenciones implícitas; ambas cadenas son ambiguas sin perfil. |
| `"1,234.50"`, `"1.234,50"` | 1234.5 | Casos mixtos bien interpretados, pero sin validación estructural general. |
| `"12,34,567"`, `"12.34.56"` | 1234567, 123456 | Agrupaciones incorrectas aceptadas bajo el supuesto occidental. |
| `"123abc"`, `"1 234,50"`, `"123-"` | 123, 1, 123 | Prefijos aceptados, valor o signo perdido. |
| `"(123)"`, `"0x10"` | 0, 0 | Formatos no admitidos ocultos como cero. |
| null, undefined, vacío, espacios, NaN, Infinity, true | 0 | Ausencia, tipo incorrecto y error colapsan al mismo resultado. |
| Array `[12]` | 12 | Coerción de un tipo que no es métrica escalar. |
| `"1e3"`, `"1e-400"` | 1000, 0 | Exponente admitido implícitamente; subdesbordamiento silencioso. |
| `"9007199254740993"` | 9007199254740992 | Pérdida de precisión entera. |

También ejecutado:

- `buildRichSummary` para valores sintéticos `["10", "20", null, "bad"]`: sum=30, avg=7.5, min=0, max=20, p50=10, p90=20. Las dos observaciones válidas tendrían promedio 15 y mínimo 10. El total 30 es un subtotal conocido, no evidencia de que el dato inválido aporte cero.
- Ranking sintético: un centro con `"bad"` queda con 0 y supera a otro con -5. La imputación inventa una posición en el ranking.
- `toNumberSmart("0.1") + toNumberSmart("0.2")` devuelve 0.30000000000000004: corregir separadores no soluciona aritmética decimal.

**No reproducido como incidente real:** corrupción de los totales del CSV actual. Con la hipótesis de miles por coma, su formato coincide con lo que el helper hace hoy. Tampoco se verificó una pérdida de precisión real de SAP: no se realizaron peticiones autenticadas.

## 5. OData: contratos conocidos y evidencia pendiente

### Contrato del código

`ODataProvider.js:61–71` y `158–168` solicitan `Accept: application/json` y llaman `response.json()`. No negocian IEEE754Compatible ni inspeccionan tipo EDM, escala o precisión. Reconocen envoltorios V2 y V4; ello no prueba que el tenant use ambos. Los mocks del repositorio solo muestran datos sintéticos, no muestras certificadas de SAP.

### Contrato normativo

En OData JSON V4.01, números se representan como números JSON; `IEEE754Compatible=true` hace que Decimal e Int64 se serialicen como cadenas. Los nulos son el literal JSON null. La notación exponencial de Decimal depende de la versión/negociación: V4.0 requiere considerar ExponentialDecimals; V4.01 la permite. Ninguna de estas reglas define coma regional ni separadores de miles para valores numéricos. [OASIS, secciones 3.2 y 7.1](https://docs.oasis-open.org/odata/odata-json-format/v4.01/os/odata-json-format-v4.01-os.html).

En V2, Decimal e Int64 se serializan como strings según su tipo, mientras Int16 e Int32 usan números JSON. No aplicar las reglas V4 a una respuesta V2 sin comprobar versión. [OData V2, Primitive Types](https://www.odata.org/documentation/odata-version-2-0/json-format/).

SAP documenta una API de consumo basada en un subconjunto de OData V4 y la obtención de metadatos del activo. Esa documentación no acredita el tipo EDM concreto de SUMA_NETA ni confirma la negociación IEEE754Compatible en este tenant. [SAP, Consuming Data Exposed by SAP Datasphere, versión 2026.22, secciones de consumo y metadata](https://help.sap.com/doc/f8cf57fada6b446c839a252c7c7d8324/cloud/en-US/f4fd00b1962a4bf8917cc9165651095c.pdf).

### Hipótesis y verificación necesaria

SUMA_NETA podría ser Decimal, Double, entero o una cadena de una vista; su nombre no permite decidirlo. Falta registrar de forma saneada: versión OData, Content-Type y parámetros, tipo EDM, Precision, Scale, Nullable y anotaciones de unidad/moneda. Después, verificar tipos JavaScript y gramática de una respuesta, sin publicar valores, tokens ni URL del tenant.

Si `response.json()` ya redondeó un número grande, el helper no puede recuperar sus dígitos. Preferir transporte decimal como string cuando el servicio lo soporte; no afirmar que cambiar solo Accept lo garantiza. Un Number decimal recibido es una aproximación binaria, no una cadena decimal exacta recuperable del origen. El fallback CSV necesita su propio perfil explícito.

## 6. Consecuencias analíticas

| Métrica | Consecuencia actual y regla propuesta |
| --- | --- |
| Suma | Nulos/errores aportan cero silencioso; signos y decimales mal leídos cambian magnitud. Separar suma conocida de total completo; nunca afirmar completitud ante datos faltantes. |
| Promedio | Ceros artificiales aumentan el denominador y arrastran hacia cero, incluso para negativos. Denominador = cantidad de valores válidos, incluido cero auténtico. |
| Min/max | Ceros inventados pueden reducir mínimo de positivos o elevar máximo de negativos. Usar solo observaciones válidas. |
| Rankings por suma | Un grupo sin métrica puede superar grupos negativos. No comparar grupos incompletos como si fueran completos. |
| Percentiles | Ceros alteran población y posición. Conservar inicialmente la definición actual: ordenar válidos y seleccionar `floor(n*p)` para p=0.5 y 0.9, sin interpolación. Para `[10,20]`, p50=20; no confundirlo con mediana interpolada 15. Cambiar definición estadística requiere aprobación separada. |
| Comparaciones mensuales | Afecta ganador y porcentajes. `compareSumaNetaMonths` divide por máximo absoluto; `compareTotalVolumeBetweenMonths` divide por sumA y puede producir porcentaje negativo si sumA<0. La diferencia de fórmulas existe independientemente del parser y no debe corregirse incidentalmente. |
| Conteos | Filas, centros y materiales no deben desaparecer por un problema en su métrica. Mantener conteos, añadir conteos de calidad independientes. |

`SummaryService.js:47–50` redondea sum y avg a dos decimales, pero deja percentiles sin ese redondeo. Los otros motores no aplican una política uniforme. Además, seleccionar una columna por coincidencia parcial o sumar unidades incompatibles puede dar resultados semánticamente incorrectos aunque el parseo sea perfecto. No se verificó mezcla real de unidades; validar dimensión/unidad es un requisito de dominio pendiente.

## 7. Alternativas evaluadas

| Alternativa | Ventaja | Limitación / decisión |
| --- | --- | --- |
| Reparar solo la rama inalcanzable | Cambio corto | Mantiene ambigüedad, coerciones y error→0. Insuficiente. |
| Último separador como decimal | Admite algunos formatos mixtos | Cambia enteros agrupados y no valida estructura. Rechazada. |
| Inferir locale por mayoría del archivo | Aprovecha patrones observados | No detecta excepciones ni archivos mixtos con certeza. Solo diagnóstico, nunca aprobación automática. |
| Perfil por origen, columna y versión | Reproducible, testeable y auditable | Requiere confirmar exportador y metadatos. Recomendada. |
| Number con suma compensada | Reduce algunos errores acumulados | No garantiza exactitud decimal ni recupera dígitos perdidos en transporte. Solo para métricas aproximadas autorizadas. |
| Coeficiente entero BigInt + escala decimal | Sumas decimales exactas sin dependencias | Requiere límites, división/redondeo y serialización explícitos. Recomendada internamente para Decimal, tras aprobar alcance. |

No se recomienda escribir una biblioteca decimal general. Limitar operaciones a normalizar, alinear escalas, sumar, comparar y dividir para presentación. No introducir dependencias en esta etapa.

## 8. Contrato propuesto — pendiente de aprobación

### 8.1 Perfil y gramática

Cada métrica declara origen/perfil, tipo, separador decimal, agrupador opcional, escala máxima, precisión y política de nulos. La configuración de la métrica viaja hasta todos sus consumidores; el helper no debe depender del locale del sistema ni únicamente de DATA_SOURCE, porque existe fallback de exportación y consultas OData directas.

Perfiles iniciales propuestos:

- **CSV entero agrupado por coma:** signo inicial opcional, dígitos sin agrupar o primer grupo de 1–3 dígitos seguido de grupos exactos de tres. Ningún decimal. Candidato para el archivo observado, pendiente de confirmación.
- **CSV decimal punto / miles coma:** parte entera simple o correctamente agrupada, fracción opcional con punto y al menos un dígito, limitada por escala declarada.
- **CSV decimal coma / miles punto:** equivalente con separadores invertidos. No activarlo por idioma o ubicación del usuario.
- **OData canónico:** punto decimal, sin agrupadores; tipo/versión controlan strings, numbers y exponentes. Edm.String no se convierte por parecer numérico sin un contrato explícito.
- **Sin perfil:** permitir enteros simples si el esquema declara métrica numérica; para textos con separadores devolver `AMBIGUOUS_FORMAT` y exigir perfil, incluso si un caso parece fácil de adivinar.

Recortar espacios externos en CSV; rechazar separadores internos de espacio/NBSP, moneda, porcentaje, comillas residuales, hexadecimal, prefijos/sufijos, signos repetidos, paréntesis y signo menos final. El parser CSV ya elimina las comillas de transporte; el conversor no debe borrar comillas del contenido. No tolerar agrupaciones irregulares. No habilitar exponentes CSV por defecto. Un perfil adicional solo se incorpora con evidencia y pruebas.

### 8.2 Resultado tipado y errores

Propuesta conceptual, no API implementada:

- `valid`: valor decimal canónico exacto, coeficiente y escala; cero y cero negativo se normalizan a cero.
- `missing`: null; CSV vacío/solo espacios se admite como missing según perfil y nulabilidad.
- `invalid`: sintaxis/tipo/rango/escala no admitidos, incluyendo NaN e infinitos.
- `ambiguous`: no hay perfil suficiente para interpretar separadores.

Undefined o columna ausente es `MISSING_FIELD` de esquema, no null de negocio. En OData una cadena vacía para un campo numérico es inválida. En un campo no nullable, incluso null debe convertirse en error de contrato.

No retornar 0, NaN ni Infinity como señal de error. Los diagnósticos incluyen códigos, columna y conteos; no valores originales ni filas de negocio en respuestas/logs. Límites de longitud, precisión y exponente se validan antes de expandir cadenas o crear grandes BigInt; los límites concretos deben derivarse del esquema aprobado.

### 8.3 Agregación y disponibilidad

Recomendación de política estricta para resultados oficiales:

1. Validar solo las métricas necesarias del conjunto consultado, conservando filas para conteos.
2. Cualquier invalid/ambiguous bloquea la métrica solicitada: no publicar total/ranking/ganador numérico como éxito. Puede devolverse un diagnóstico de calidad; no omitir errores silenciosamente.
3. Null permitido se excluye de promedio, extremos y percentiles. Si hay nulos, identificar resultado como parcial con `validCount`, `missingCount`, `invalidCount`, `ambiguousCount` y `rowsMatched`. La suma es una suma de observaciones conocidas, no el total del universo. No declarar ganador o ranking completo entre grupos con cobertura incompleta.
4. Sin filas: suma 0 con estado `empty`; promedio y percentiles sin valor. Con filas pero todas null: métricas null con estado `no_valid_values`, nunca cero observado. Cero real: válido y cuenta en el denominador.
5. Las 68 pruebas anteriores deben mantenerse como control de la Etapa 1; cualquier cambio esperado en forma HTTP debe aprobarse y probarse explícitamente, no resolverse debilitando pruebas.

Esto exige una decisión HTTP: campos de calidad, valores null y error de dato numérico (propuesta: 422 para una consulta que no puede calcularse por calidad del dato). No se cambia ningún endpoint ahora. Si no se aprueba ampliar respuestas, usar un error explícito para resultados parciales en vez de devolver números sin advertencia. Los adaptadores de chat también deben impedir convertir parciales en afirmaciones de negocio.

### 8.4 Precisión y redondeo

Para Decimal exacto, interpretar texto directamente a coeficiente BigInt y escala; no pasar por parseFloat ni por Number antes. SUMA_NETA no adquiere escala 2 por el nombre: la escala autorizada viene del modelo/exportador. Exceso de escala es error, no redondeo silencioso.

Sumar y comparar en decimal exacto; redondear únicamente promedios/porcentajes o presentación a una escala aprobada. Proponer mitad alejándose de cero, simétrica para negativos, y probar empates. Conservar inicialmente el percentil discreto actual.

Los valores de precisión arbitraria no caben necesariamente en un número JSON compatible con clientes JavaScript. Propuesta: solo emitir Number si la representación decimal resultante puede convertirse y volver a la misma representación canónica, además de cumplir rango seguro para enteros. Si no, devolver `UNSAFE_OUTPUT` hasta aprobar strings decimales en HTTP; BigInt nunca se serializa directamente. Esta comprobación preserva el texto decimal de salida, no promete que el cliente opere con aritmética exacta.

Para Number ya recibido del transporte, aceptar enteros seguros; para Decimal fraccionario exigir transporte textual verificable en el modo exacto. Un perfil de Double aproximado debe declarar tolerancia por métrica y no prometer igualdad decimal exacta. `1e-400` no puede volverse cero silenciosamente: expandirlo exactamente solo si escala/límites lo permiten, o rechazarlo.

## 9. Matriz de regresión propuesta

Todos los ejemplos son sintéticos. Resultados sujetos a aprobar el contrato anterior. No se han implementado ni ejecutado estas nuevas pruebas Jest.

Abreviaturas: I = CSV entero con miles coma; P = decimal punto/miles coma; C = decimal coma/miles punto; O = OData numérico con contrato conocido; U = sin perfil. Escala de P/C en estas fixtures: hasta 3. `valid(x)` denota decimal exacto, no un float intermedio.

| Entrada / escenario | Perfil | Esperado | Justificación |
| --- | --- | --- | --- |
| `"42"`, `"-42"`, `"+42"` | I/P/C | valid(42/-42/42) | Signo inicial explícito. |
| `"0"`, `"-0"`, `"-0.000"` | P | valid(0) | No conservar cero negativo. |
| `"1,234"` | I/P | valid(1234) | Perfil declara agrupador. |
| `"1,234"` | C | valid(1.234) | Perfil declara decimal. |
| `"1.234"` | P / C | valid(1.234) / valid(1234) | No existe interpretación universal. |
| `"1,234"`, `"1.234"`, `"1,50"` | U | ambiguous | Exigir perfil aun en formatos aparentemente probables. |
| `"1,234,567"`, `"-1,234,567"` | I | valid(1234567/-1234567) | Miles múltiples y negativos. |
| `"1,50"`, `"-1,50"` | C | valid(1.5/-1.5) | Reproduce el defecto de coma decimal. |
| `"1,50"` | I/P | invalid | No inferir otro locale al fallar agrupación. |
| `"1,234.50"` / `"1.234,50"` | P / C | valid(1234.5) | Formatos mixtos declarados. |
| `"1.50"` | I | invalid | Perfil entero no permite fracción. |
| `"12,34,567"`, `"1234,567"` | I | invalid | Grupos occidentales irregulares. |
| `"12.34.56"` | C | invalid | No borrar puntos sin validar. |
| `"1,,234"`, `"1.2.3"`, `"1,"`, `".5"` | P | invalid | Gramática completa; requerir parte entera y fracción no vacía. |
| `" 42 "` | I | valid(42) | Espacios exteriores CSV permitidos. |
| `"1 234,50"`, `"1\u00a0234,50"` | C | invalid | No eliminar espacios interiores. |
| `"123abc"`, `"123-"`, `"(123)"`, `"$123"`, `"12%"` | I | invalid | No aceptar prefijos ni signos alternativos. |
| Contenido `"1\"2"` | I | invalid | No borrar comillas de datos. |
| `"0x10"`, `"--1"`, `"+-1"` | I | invalid | Tipo/gramática estrictos. |
| null | Nullable I/O | missing | Ausencia no es cero. |
| null | No nullable | invalid | Violación de esquema. |
| `""`, espacios | Nullable CSV | missing | Política de celdas vacías declarada. |
| `""`, `"null"`, `"NULL"`, `"N/A"` | O numérico | invalid | Strings no son literal null. |
| undefined / propiedad ausente | Todos | MISSING_FIELD | Métrica requerida ausente. |
| true, false, `[12]`, `{}` | Todos | invalid | No coerción genérica a string. |
| NaN, Infinity, `"NaN"`, `"INF"`, `"-INF"` | Todos | invalid | No métricas finitas válidas. |
| `"1e3"` | I/P/C | invalid | CSV sin exponentes por defecto. |
| `"1e3"` | O con exponentes permitidos | valid(1000) | Dependencia de tipo y versión. |
| `"1,234.50"` | O | invalid | JSON numérico no tiene agrupadores. |
| `"25.50"` | O Decimal textual | valid(25.5) | Decimal canónico. |
| 25 como Number | O entero seguro | valid(25) | Entero transportado sin pérdida. |
| 0.1 como Number | O Decimal exacto | error de precisión de transporte | No certificar exactitud del origen tras response.json. |
| `"9007199254740993"` | O Int64 textual | Exacto interno; UNSAFE_OUTPUT numérico | Evitar redondeo a otro entero. |
| 9007199254740992 como Number | O entero | invalid/rango inseguro | No afirmar que se conservaron todos los dígitos originales. |
| `"1.2345"` | P escala máxima 3 | invalid/escala | No truncar ni redondear al ingresar. |
| `"1e-400"` | O escala máxima 3 | invalid/escala | Impedir subdesbordamiento a cero. |
| Entrada o exponente sobre límite declarado | Todos | invalid/límite | Rechazo anterior a expansión/asignación grande. |
| 0.1 + 0.2 textuales | P/exacto | sum=0.3 | Aritmética exacta interna. |
| 1000.25 + (-1000.25) | P | sum=0 | Cancelación exacta de signos. |
| `[10,20,null]` | Nullable | sumKnown=30, avg=15, min=10, max=20, p50=20, p90=20; partial | Nulo no aumenta denominador; mantener percentil discreto. |
| `[10,20,"bad"]` | P | Métrica bloqueada, invalidCount=1 | No subtotal silencioso. |
| `[null,null]` | Nullable | métricas null, no_valid_values | No fabricar cero. |
| `[0,0]` | P | sum/avg/p50/p90=0, validCount=2 | Distinguir cero observado. |
| `[]` | Todos | sum=0, avg/percentiles=null, empty | Distinguir población vacía. |
| Grupo A inválido y grupo B=-5 | P | Ranking bloqueado por calidad | No colocar grupo inválido encima del negativo. |
| Un mes incompleto y otro completo | Nullable | Sin ganador global | Coberturas no comparables. |
| 1.005 y -1.005 a escala 2 | Redondeo aprobado | 1.01 y -1.01 | Mitad alejándose de cero, sin artefacto binario. |
| CSV y OData con misma magnitud sintética | Perfiles declarados | Agregados iguales | Paridad por contrato, no por formato textual. |
| Error de métrica con filas válidas | Todos | Conteo de movimientos sin cambios | Calidad numérica no elimina movimientos. |
| Fixture de carga/recarga de Etapa 1 | Existente | 68 controles anteriores conservados | No regresión de providers/cachés. |

## 10. Aprobaciones requeridas y criterios de aceptación

Decisiones pendientes:

1. Confirmar que la exportación local declara miles por coma y escala cero; definir perfiles de otros CSV, incluido fallback. Sin confirmación, no activar inferencia automática.
2. Confirmar tipo/escala/precisión/nulabilidad/unidad de SUMA_NETA y demás métricas en SAP y verificar el transporte del tenant. Acordar qué hacer si Decimal llega como Number.
3. Aprobar error estricto para invalid/ambiguous, política de parciales ante null y cambios HTTP/chat necesarios para comunicar calidad.
4. Aprobar aritmética decimal interna, límites y redondeo; decidir strings HTTP para resultados que no admiten Number seguro o mantener UNSAFE_OUTPUT.
5. Conservar percentiles y fórmulas comparativas existentes, o abrir un cambio estadístico explícito. No mezclarlo silenciosamente con conversión.

Aceptar la futura implementación cuando cada origen/métrica tenga perfil trazable, no haya coerción de errores a cero ni inferencia por celda, se valide toda la cadena, y todos los consumidores compartan las mismas reglas. Exigir paridad CSV/OData con fixtures sintéticas, matriz de errores y precisión cubierta, conteos no alterados, y regresión de la Etapa 1 en verde. Los resultados parciales no deben presentarse como totales completos ni ganadores en API o chat.

No hay cambios de código autorizados por este documento. La garantía de completitud OData, paginación, compatibilidad de unidades y alineación estructural CSV siguen siendo aspectos separados de integridad; un parser numérico correcto no los resuelve.

## 11. Verificación realizada y reproducción

Se revisó Git al inicio, se buscaron todas las referencias del helper, se ejecutó clasificación completa local y reproducciones sintéticas en Node, y se consultaron las fuentes oficiales enlazadas. No se ejecutó nuevamente Jest en esta etapa documental: el resultado 68/68 corresponde a la Etapa 1 y a la ejecución independiente informada por el usuario.

Comandos de lectura y reproducción sintética (PowerShell, raíz del repositorio):

```powershell
git status --short
rg -n 'toNumberSmart|sumBy\(|numericStats|totalVolumeByMonth|compareSumaNetaMonths' src tests
node -e 'const f=require("./src/utils/helpers").toNumberSmart; for(const x of ["1,50","-1,50","123abc",null,"9007199254740993"]) console.log(x,f(x));'
node -e 'const s=require("./src/services/SummaryService"); console.log(s.buildRichSummary(["10","20",null,"bad"].map(SUMA_NETA=>({SUMA_NETA}))).numericStats);'
git diff --check
```

Reproducción de la clasificación principal, sin imprimir valores reales:

```powershell
@'
const provider = require('./src/providers/CsvProvider');
(async () => {
  const rows = await provider.loadData();
  const stats = { rows: rows.length, missing: 0, empty: 0, integers: 0,
    groupedComma: 0, oneComma: 0, multipleComma: 0, dots: 0, negative: 0, invalidForIntegerProfile: 0 };
  for (const row of rows) {
    const raw = row.SUMA_NETA;
    if (raw == null) { stats.missing++; continue; }
    const s = String(raw);
    if (!s.trim()) { stats.empty++; continue; }
    if (/^[+-]?\d+$/.test(s)) stats.integers++;
    if (/^[+-]?\d{1,3}(,\d{3})+$/.test(s)) stats.groupedComma++;
    const commas = (s.match(/,/g) || []).length;
    if (commas === 1) stats.oneComma++;
    if (commas > 1) stats.multipleComma++;
    if (s.includes('.')) stats.dots++;
    if (s.startsWith('-')) stats.negative++;
    if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(s)) stats.invalidForIntegerProfile++;
  }
  console.log(stats);
})();
'@ | node
```

Los conteos describen exclusivamente el archivo presente en esta revisión; otro archivo puede cambiar la distribución y debe revalidarse sin copiar datos de negocio a fixtures ni documentación.
