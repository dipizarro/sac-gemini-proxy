# Issue 001 — Implementación Etapa 2B

Fecha: 2026-11-04. Cambios locales para revisión; sin commit ni push.

## Resultado

Implementado transporte OData V4 con `$format=application/json;IEEE754Compatible=true` y Accept equivalente. El motor acepta SUMA_NETA textual canónica solo si cabe en el rango entero seguro de JavaScript. Comprueba también sumas parciales y diferencias. EXPORT queda registrado sin perfil aprobado: sus métricas se bloquean y los conteos permanecen disponibles.

La suite final ejecutada aprobó **170/170 pruebas en 10 suites**. No se utilizó el tenant real. No se agregaron dependencias, BigInt ni aritmética decimal general.

## Archivos y decisiones

- `src/services/ODataTransport.js`, nuevo: negociación compartida, validación Content-Type, versión declarada, payload V4, representación textual Int64, conteo seguro y errores saneados. No lee ni incorpora cuerpos de error HTTP a excepciones. Registra el origen ODATA con perfil únicamente para SUMA_NETA.
- `src/providers/ODataProvider.js`: usa ese contrato tanto para carga completa como consultas filtradas. Conserva el bucle `$top/$skip` existente y la ausencia de paginación del método filtrado. Elimina logs de filtros, conteos y mensajes de error remotos.
- `src/services/DataService.js`: fetchMovMat aplica la misma negociación/validación y mantiene la forma JSON de respuesta. Registra los arrays del fallback como EXPORT. Un error de transporte OData no activa silenciosamente la exportación.
- `src/utils/numeric.js`: registro de origen CSV/ODATA/EXPORT por identidad del array; perfil `odata-int64`; errores con origen correcto; guardas aritméticas para todos los snapshots registrados. Conserva perfil y parser CSV aprobados.
- QueryEngineService, InsightEngineService, SummaryService y CsvController: extienden las guardas de ausencia de métrica y cobertura a todos los orígenes estrictos. Los consumidores ya integrados reutilizan readMetric/add/difference.
- `src/middlewares/errorHandler.js`: responde errores de transporte con 502 y errores de calidad con 500, sin stack ni datos originales.
- `tests/ODataNumeric.test.js`, nuevo: respuestas sintéticas, negociación, formatos, tipos, límites, acumulados/diferencias, carga/consulta, fetchMovMat, conteos, paridad y HTTP/chat.
- `tests/NumericSources.test.js`: actualización puntual aprobada por el usuario para que EXPORT rechace sumas sin contrato y conserve conteos. La expectativa anterior exigía precisamente la suma ahora prohibida. Las otras 138 pruebas anteriores no fueron reescritas.

## Contrato

SUMA_NETA OData debe transportarse como string o null. Un número JSON para esa propiedad se rechaza como `INT64_REPRESENTATION`, incluso si parece seguro: no se permite incumplir la negociación. Los campos ausentes se detectan al pedir la métrica; las proyecciones destinadas a conteos pueden legítimamente omitirla.

El perfil acepta signo menos opcional y entero canónico sin agrupadores, decimal, exponente, espacios o ceros iniciales redundantes. Admite cero y normaliza -0. Limita longitud y rechaza entradas fuera de Number.isSafeInteger. Null produce estado missing; undefined produce MISSING_FIELD; vacío/formato incorrecto son invalid. Otra métrica OData no recibe automáticamente este perfil: se bloquea como ambigua si no tiene contrato.

Content-Type exige application/json y exactamente un parámetro IEEE754Compatible=true (admite el valor entre comillas). Si OData-Version está presente, debe ser 4.0 o 4.01. Se exige envoltorio V4 `value` con registros objeto. Se comprueba representación Int64 antes de entregar filas; null y strings mal formados llegan al control de calidad al calcular. No se ofrecen resultados parciales ante calidad insuficiente.

`@odata.count`, si está presente, se valida como string entero seguro no negativo. Una consulta count sin esa propiedad falla explícitamente: no devuelve un array como sustituto. El conteo resultante sigue siendo Number en las respuestas exitosas.

Los errores `ODATA_TRANSPORT_ERROR` usan 502 porque la respuesta upstream incumple el contrato o la petición remota falla. Sus razones son genéricas (HTTP_ERROR, CONTENT_TYPE, VERSION, INVALID_JSON, INVALID_PAYLOAD, INVALID_RECORD, INT64_REPRESENTATION, INVALID_COUNT, REQUEST_FAILED). No incluyen URL, token, valores ni cuerpo remoto. Los errores DATA_QUALITY_ERROR de una métrica o acumulado mantienen 500: el problema no son parámetros incorrectos del usuario. No se introdujo 422.

ChatController conserva su flujo y propaga estos errores al middleware. Se probaron respuesta válida y bloqueos por null, representación numérica incompatible y Content-Type incorrecto: no se devuelve una afirmación numérica engañosa ante error.

## Evidencia de ejecución

1. Baseline: **139/139** aprobadas, 9 suites, antes de cambios de producción.
2. Regresiones iniciales y expectativa EXPORT actualizada: **22 fallos y 6 aprobadas**. Demostraron negociación anterior, aceptación silenciosa de transporte/valores inseguros y exportación sin contrato.
3. Primera integración completa: **165/165**, 10 suites.
4. Final, incluyendo HTTP/chat y paridad: **170/170**, 10 suites, código de salida 0.

Las pruebas usan fetch simulado y Responses sintéticas. HTTP/chat usa Express real en loopback con puerto efímero y cierre del servidor; el permiso ampliado fue para localhost. No se consultó SAP ni Gemini. Las cinco pruebas añadidas al final amplían cobertura; no se presentan como casos ejecutados en rojo antes de implementar.

Se verificaron positivos, negativos, cero, null, campo ausente, vacío, separadores, decimal, exponente, sufijos, entero inseguro, acumulados y diferencias inseguras. También se verificaron carga completa, consulta filtrada, fetchMovMat, conteos válidos/negativos/ausentes/inseguros/no textuales, errores HTTP y paridad sintética CSV `1,234` frente a OData `1234`.

Comando final ejecutado:

```powershell
node node_modules/jest/bin/jest.js --runInBand --silent --cache=false
git diff --check
git diff --stat
git status --short
```

`git diff --check` sin errores. Git estaba limpio al comenzar la implementación, antes de actualizar la expectativa autorizada. No se modificaron configuraciones privadas ni archivos de datos. Las respuestas exitosas conservan sus estructuras; los casos antes inseguros ahora fallan explícitamente.

## Límites y pendientes

- No se valida metadata remotamente en cada carga: el perfil SUMA_NETA Int64 corresponde al contrato aprobado tras descubrimiento. Un cambio de esquema requiere revisión del perfil.
- No se cambió paginación ni se garantiza completitud de consultas filtradas. Tampoco se corrigieron fórmulas estadísticas, unidades o precisión decimal de promedios/porcentajes.
- El rango admitido es más estrecho que todo Int64. Entradas y acumulados fuera del rango seguro se rechazan; no se aproximan. Una cancelación posterior no permite continuar después de un acumulado inseguro.
- Arrays ajenos al registro mantienen el camino legado por compatibilidad. Las rutas reales del provider y fallback sí registran su procedencia. Copiar/deserializar arrays pierde la identidad: futuras transformaciones deben transportar explícitamente el contrato.
- EXPORT no tiene perfil numérico aprobado. La carga y conteos pueden continuar; las métricas fallan por falta de contrato. No se implementó descubrimiento ni se ejecutaron jobs de exportación.
- La validación de transporte inspecciona SUMA_NETA y @odata.count; no asume que todas las otras propiedades sean Int64. Antes de incorporar otra métrica se requiere su contrato y validación de representación.
- El cliente requiere payload V4. La antigua tolerancia a envoltorios V2 se elimina en estas rutas negociadas V4 para evitar aceptar respuestas incompatibles silenciosamente.
- Los mecanismos OAuth y Export existentes no se refactorizaron; el límite OData sanea fallos propagados por OAuth. Una revisión integral del logging de Export y endpoints ajenos al motor sigue pendiente.

Entrega lista para revisión local. Sin commit ni push.
