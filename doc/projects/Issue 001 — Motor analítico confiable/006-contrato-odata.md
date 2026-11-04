# Issue 001 — Etapa 2B: descubrimiento del contrato OData

Fecha: 2026-11-04, America/Santiago. Estado: diagnóstico y propuesta; implementación pendiente de aprobación.

## 1. Hallazgo principal

El servicio configurado respondió correctamente y declaró **SUMA_NETA como Edm.Int64**, con **OData 4.0**. No declaró Precision, Scale ni Nullable en esa propiedad. Precision/Scale no son facetas aplicables a Int64; no deben inventarse como atributos del modelo. Al omitirse Nullable en una propiedad escalar CSDL, su valor efectivo es true.

La consulta mínima con la negociación actual devolvió números JSON. Una segunda consulta de lectura con `IEEE754Compatible=true`, declarado tanto en `$format` como en Accept, devolvió strings y confirmó ese parámetro en Content-Type. El servicio permite, por tanto, transportar esta métrica sin pasar primero por la conversión binaria de números JSON.

**Recomendación:** implementar un perfil OData de enteros canónicos, transporte textual Int64 y validación de rango/operaciones antes de producir resultados. Para SUMA_NETA no se necesita aritmética decimal general según el esquema observado. Number es suficiente para el subconjunto de enteros seguros y acumulados seguros; no cubre todo el dominio Int64.

El fallback de exportación sigue sin contrato comprobado: no hay URL configurada y el cliente local presupone una API de jobs. No se ejecutó ese flujo porque crea un job y esta etapa solo autoriza lectura de SAP.

## 2. Alcance y preservación del repositorio

Git estaba limpio al comenzar. Solo se agrega este documento; no se cambiaron código, configuración, credenciales, datasets, dependencias ni pruebas. No hubo commit ni push.

La inspección local de configuración publicó únicamente presencia/ausencia de variables y categorías de ruta, nunca valores secretos. Los cuerpos de metadata y muestras remotas se procesaron en memoria y no se guardaron. No se publican hostname, tenant, espacio, activo, entity set, etiqueta de negocio, unidades reales, tokens, IDs ni valores numéricos de negocio.

No se ejecutaron los clientes de producción que imprimen URLs, filtros, detalles de errores o IDs de exportación. Se utilizaron sondas efímeras con HTTPS, redirects deshabilitados, timeout de 15 segundos y salidas acotadas a estado HTTP, versión, facetas y forma léxica. No se consultó el dataset completo ni se utilizó paginación.

## 3. Configuración y clientes actuales

| Componente | Evidencia y consecuencia |
| --- | --- |
| `src/config/config.js:18–28` | DATASPHERE_ODATA_URL y las tres variables OAuth están presentes. URL OData HTTPS de consumo relacional, sin credenciales incrustadas ni query. DATASPHERE_EXPORT_URL está ausente. DATASPHERE_USER/PASS también existen, pero no se usaron: el provider usa OAuth. |
| `src/services/OAuthService.js:11–64` | Client Credentials: POST al endpoint de autenticación con Basic del cliente y grant_type. Token cacheado según expires_in con margen de 60 segundos. No solicita scope adicional. La vigencia o alcance no se deduce por presencia de credenciales: se verificaron respuestas autorizadas. |
| `src/providers/ODataProvider.js:34–104` | Carga completa por GET con Bearer, `$top`, `$skip`, `$format=json`, Accept application/json; `response.json()` en línea 71. Conserva valores al normalizar claves. |
| `src/providers/ODataProvider.js:127–189` | Consulta filtrada, sin paginación; mismo formato y `response.json()` en línea 168. Para conteo hace `Number(countVal)` en línea 175. La adaptación V2/V4 de envoltorios no acredita uso real de V2. |
| `src/services/DataService.js:79–124` | Existe otra consulta OData `fetchMovMat`, también con `$format=json` y `response.json()`. Debe incluirse en cualquier futura auditoría de negociación, aunque no sea la ruta principal del motor. |
| `src/services/DataService.js:167–187` | Si falla la carga normal y hay exportUrl, crea/descarga CSV con ExportService y lo parsea a strings. Sin esa URL, el fallback no se activa. |
| `src/services/ExportService.js:25,65,118,152` | Presupone POST `/jobs`, GET `/jobs/{id}`, GET `/jobs/{id}/data`; campos id/jobId y estados completed/success. Son expectativas del código, no contratos confirmados con un servicio real. |
| `src/utils/numeric.js:42–54` | Etapa 2A aplica el perfil estricto solo a snapshots registrados por CsvProvider. OData y export fallback continúan delegando a toNumberSmart y no tienen guardas de acumulación CSV. |

OAuthService y los clientes incorporan cuerpos de error remotos en excepciones. ExportService además imprime resourcePath y jobId. Se evitó usar esas rutas para este diagnóstico; una futura implementación debería sanear diagnósticos antes de exponerlos. No se modificó logging ahora.

## 4. Endpoints de descubrimiento

La forma pública del endpoint configurado corresponde a:

```text
GET <origen>/api/v1/datasphere/consumption/relational/<espacio>/<activo>/<entidad>
GET <origen>/api/v1/datasphere/consumption/relational/<espacio>/<activo>/$metadata
```

El segundo se deriva de la raíz del servicio del activo, no agregando `$metadata` al final del entity set. Se comprobó la forma de ruta antes de derivarlo. La llamada a `$metadata` devolvió HTTP 200. No se probaron rutas arbitrarias ni se enumeraron otros activos.

SAP documenta la obtención de metadata del activo y la generación de solicitudes Data/Metadata/Service desde sus editores. El documento de servicio de esa raíz es otra vía disponible para identificar entity sets; no fue necesario consultarlo en esta sesión. [SAP, Consuming Data Exposed by SAP Datasphere, versión 2026.22, secciones Generate OData Requests y Retrieve Asset Metadata](https://help.sap.com/doc/f8cf57fada6b446c839a252c7c7d8324/cloud/en-US/f4fd00b1962a4bf8917cc9165651095c.pdf).

No hay mecanismo `$metadata` implementado en ODataProvider. La sonda fue independiente y no añadió un endpoint al proxy.

## 5. Evidencia remota saneada

| Operación | Resultado observado |
| --- | --- |
| Primer intento OAuth dentro del sandbox | Falló con ENOTFOUND; no hubo respuesta HTTP. |
| Autenticación con acceso de red ampliado | HTTP 200 y token utilizable, solo en memoria. |
| GET metadata | HTTP 200; OData-Version: 4.0. |
| Propiedad SUMA_NETA | Una declaración encontrada; Type=Edm.Int64. |
| Precision / Scale | Atributos ausentes; no aplicables como facetas de Int64. |
| Nullable | Atributo ausente; true efectivo según CSDL para propiedad escalar. |
| Anotaciones directamente asociadas a SUMA_NETA | Un bloque externo; se identificó Common.Label. Su contenido no se publicó. |
| Unidad / moneda | No se encontraron términos Unit ni ISOCurrency inline o en el bloque externo de la propiedad inspeccionada. |
| GET mínimo con `$select=SUMA_NETA`, `$top=3`, `$format=json` | HTTP 200; OData-Version 4.0; application/json sin IEEE754Compatible=true; tres valores no nulos, tipo JavaScript number, tokens enteros sin coma/punto/exponente y dentro de rango seguro. |
| GET mínimo con `$format=application/json;IEEE754Compatible=true` y Accept equivalente | HTTP 200; OData-Version 4.0; Content-Type declara IEEE754Compatible=true; tres valores no nulos de tipo string, sin coma/punto/exponente. |

Se realizaron dos autenticaciones exitosas, dos GET de metadata y dos GET de muestra mínima. El único POST fue la obtención de tokens OAuth: no ejecutó operaciones de escritura de datasets, creación de jobs ni acciones de negocio en SAP. No hubo llamadas POST a la API de consumo ni a ExportService.

El diagnóstico ENOTFOUND inicial fue una limitación del entorno restringido: la ejecución con red ampliada sí resolvió y obtuvo HTTP 200. No debe documentarse como indisponibilidad del tenant.

La muestra de tres filas no certifica ausencia de nulls o valores grandes en el resto del dataset. Tampoco constituye comparación fila a fila entre las dos peticiones: no se pidió orden estable ni identificadores. Confirma representación y negociación, no igualdad o exhaustividad de datos.

La búsqueda de anotaciones se limitó a la propiedad y su target externo en ese documento. No prueba ausencia de semántica de unidades en otros campos, referencias o documentación de negocio. Una etiqueta no establece aditividad ni compatibilidad de unidades.

### Interpretación normativa, separada de lo observado

La omisión de Nullable en propiedades escalares implica true. Precision está definida para decimal y ciertos tipos temporales; Scale para decimal. Por eso no se traduce la ausencia de esas facetas de Int64 a un supuesto Decimal(p,0). [OASIS CSDL V4.0, secciones 6.2.1–6.2.4](https://docs.oasis-open.org/odata/odata/v4.0/os/part3-csdl/odata-v4.0-os-part3-csdl.html).

OData JSON V4.0 dispone que IEEE754Compatible=true serialice Int64 y Decimal como strings. `$format` prevalece sobre Accept; para parámetros se usa el MIME completo, no `json;IEEE754Compatible=true`. Esto explica por qué una futura corrección no debe limitarse a cambiar Accept mientras mantiene `$format=json`. [OASIS JSON V4.0, secciones 3 y 3.2](https://docs.oasis-open.org/odata/odata-json-format/v4.0/os/odata-json-format-v4.0-os.html).

## 6. Riesgo de pérdida durante response.json()

Int64 permite enteros con signo de 64 bits; Number representa exactamente todos los enteros solo entre -(2^53−1) y +(2^53−1). El dominio EDM es mayor. Si el servidor envía un entero grande como token JSON numérico, response.json() puede redondearlo antes de que el motor valide o convierta nada. toNumberSmart no puede reconstruir dígitos perdidos.

Se reprodujo localmente, con un cuerpo sintético y `new Response(...).json()`, el caso 9007199254740993: el valor parseado no conserva el entero original y no es un entero seguro. Se imprimieron únicamente booleanos de pérdida y seguridad. **Este es un fallo de precisión reproducido con datos sintéticos, no una afirmación de corrupción observada en SAP.** Los tres tokens numéricos de la muestra real eran seguros.

Transportar Int64 como string evita esa primera pérdida. No resuelve por sí solo el siguiente paso: el camino legado todavía convierte strings grandes con parseFloat y puede redondearlos. Deben cambiar conjuntamente negociación, perfil y guardas de agregación. @odata.count requiere la misma atención si pasa a string; no basta con conservar el Number(countVal) actual sin comprobación.

## 7. Contrato del fallback CSV: investigación separada

### Conocido por código

ExportService envía `{resourcePath, format: 'csv'}` para crear un job. No declara separadores, locale, escala, nulabilidad, codificación o política de números. Descarga bytes; DataService utiliza csv-parse con columnas normalizadas, trim, skip_empty_lines y relax_quotes. No define cast numérico; los valores siguen como strings. El perfil de CsvProvider no se adjunta al fallback, correctamente según Etapa 2A.

El parser del fallback no incorpora la detección de doble encabezado ni la lógica específica del CSV local. Su primera fila debe actuar como encabezado bajo las opciones actuales. Es una expectativa del cliente, no evidencia del formato real de exportación.

### No comprobado y razón

DATASPHERE_EXPORT_URL no está configurada; no hay endpoint ni artefacto de exportación verificado en esta sesión. Además, `exportToCsvBuffer` crea un job mediante POST. No se ejecutaron ni ese método ni `/ds/export/preview`: aunque el endpoint del proxy sea GET, su implementación crea el job. No se intentó deducir un job existente ni usar IDs desconocidos.

No se conocen el tipo textual real de SUMA_NETA exportado, agrupadores, decimal, representación de null, precisión, unidades ni correspondencia con el activo OData. Tampoco está probado que el API real ofrezca las rutas genéricas `/jobs` que presupone el código.

**No trasladar automáticamente** el perfil CSV local ni el contrato de serialización JSON OData al exportador. Aun si ambos provienen del mismo activo Int64, el CSV puede aplicar formato de presentación o representar ausencias de otra manera.

Para cerrar este contrato: identificar la API documentada y su formato, obtener un artefacto existente mediante GET autorizado o un archivo saneado, y clasificar léxico/encabezados/nulos sin publicar valores. Si obtenerlo exige crear un job, se necesita una autorización específica para esa operación en otra etapa; este documento no la presupone.

## 8. Alternativas aritméticas y recomendación

| Alternativa | Garantía | Evaluación |
| --- | --- | --- |
| Mantener números JSON y toNumberSmart | Ninguna garantía para todo Int64; errores/nulos pueden convertirse en cero | No recomendada. |
| Int64 textual + Number con validación estricta | Exactitud para entradas y acumulados dentro del rango seguro; rechazo explícito fuera de él | Recomendada como implementación mínima. No garantiza disponibilidad para todo Int64. |
| Int64 textual + BigInt para sumas/comparaciones | Exactitud entera incluso fuera del rango seguro de Number | Alternativa si el negocio exige procesar todo el dominio; requiere acordar strings HTTP/errores de salida y promedios. No es aritmética decimal general. |
| Motor decimal general | Útil para futuras métricas Edm.Decimal con escala y redondeo explícitos | No justificado por SUMA_NETA Int64 observada. Revaluar por métrica, no por nombre del servicio. |

Con Number, validar cada valor antes de usarlo y cada acumulado/diferencia antes de devolverlo. El límite es deliberadamente más estrecho que Int64: habrá error estructurado ante valores válidos de SAP que no sean seguros en JavaScript. No convertirlos a cero ni aceptar aproximaciones silenciosas. La política de Etapa 2A ya establece un precedente para ese rechazo conservador.

Promedios y porcentajes no suelen ser enteros y seguirán siendo aproximaciones con Number; deben conservar una política de presentación explícita. La decisión sobre exactitud de cocientes/redondeo es distinta de la necesidad de preservar enteros del transporte. No se infiere que toda métrica del servicio sea Int64 porque SUMA_NETA lo sea.

## 9. Propuesta técnica para la siguiente implementación

Pasos propuestos, no ejecutados:

1. **Contrato por origen/métrica:** generalizar el registro de snapshots de numeric.js para conservar CSV, ODATA y EXPORT como procedencias distintas; mantener intacto el perfil CSV aprobado. Registrar OData tanto al cargar por caché como en executeFilteredQuery, que alimenta directamente al chat.
2. **Transporte Int64:** negociar `$format=application/json;IEEE754Compatible=true` y Accept coherente en las rutas OData relevantes; verificar Content-Type y representación. No modificar paginación dentro de ese cambio. Incluir fetchMovMat en el inventario de consumidores para evitar una ruta residual sin auditoría.
3. **Parser canónico Int64:** validar cadena completa de entero sin miles, decimal, espacio interno ni exponente. Validar tipo EDM y límites; convertir a Number solamente después de comprobar rango seguro. Evitar reutilizar el perfil de comas del CSV.
4. **Calidad:** null está permitido por el esquema, pero no equivale a cero. Aplicar la política estricta del motor: la métrica consultada con cobertura incompleta no se presenta como total/ranking/ganador completo. Conservar conteos de movimientos. Campo ausente debe distinguirse de null.
5. **Errores y contexto:** generalizar DataQualityError para indicar origen ODATA/EXPORT sin exponer valores ni identificadores. Mantener 500 para calidad/configuración del dataset; decidir separadamente el tratamiento de incumplimientos del transporte upstream, sin introducir 422 automático.
6. **Guardas y salida:** extender comprobación de sumas/diferencias seguras a OData y @odata.count. Mantener estructuras exitosas con números seguros. Fuera de rango, error explícito hasta aprobar BigInt/strings HTTP si se requieren.
7. **Export:** no activar un perfil por defecto. Una futura integración debe bloquear o declarar explícitamente la falta de contrato antes de ofrecer cálculos del fallback como fiables. Hoy ese camino aún usa lógica legada; cambiar su política requiere aprobación y pruebas propias cuando se disponga del formato.

La metadata puede comprobarse de forma controlada al configurar/refrescar el contrato, sin añadir una consulta por cada celda. Si cambia Type/Nullable o la fuente, invalidar/revalidar el contrato junto con el snapshot; no aplicar un perfil antiguo a una versión de datos nueva. No se propone persistir metadata privada en el repositorio.

## 10. Pruebas y criterios de aceptación propuestos

| Caso sintético | Resultado esperado |
| --- | --- |
| Int64 textual `"1234"`, `"-1234"`, `"0"` | Enteros exactos; cero real válido. |
| `"1,234"`, `"1.0"`, `"1e3"`, `"123abc"` | Error de formato OData; no interpretación regional ni parcial. |
| null / propiedad ausente | Estados diferentes; ninguna imputación silenciosa a cero. |
| ±9007199254740991 textuales | Valores seguros aceptados; operaciones también verificadas. |
| `"9007199254740993"` textual | Rango inseguro rechazado sin redondear. |
| JSON numérico inseguro recibido pese a negociación | Fallo de transporte/calidad; no intento de rescatar precisión. |
| Int64 válido fuera del rango Number o suma de seguros que desborda | Error estructurado, sin subtotal aparente. |
| $format=json junto con Accept parametrizado | Prueba que evita esa combinación en la futura implementación. |
| Content-Type sin parámetro o tipo JSON inesperado | Incumplimiento detectable; no conversión ciega. |
| @odata.count textual | Validación entera segura, distinta de métricas nullable. |
| Mismo valor sintético CSV agrupado y OData canónico | Igual resultado con perfiles distintos. |
| Export con origen CSV activo | No hereda el perfil local; exige contrato propio. |
| Chat/query mensual con OData incompleto | Sin ganador/exactitud ficticia; conteos disponibles. |
| Cambio de contrato y recarga | Dataset y derivados siguen coherentes según Etapa 1. |

Aceptar una implementación futura con regresión de las 139 pruebas existentes, nuevos casos de transporte/perfil/rango y HTTP/chat aprobados, sin datos reales en fixtures y sin alterar reglas CSV. No es criterio suficiente que la muestra mínima actual sea segura: debe haber guardas para el dominio completo que el servicio puede enviar.

## 11. Límites y decisiones pendientes

**Comprobado:** conectividad/autorización para metadata y muestra mínima; OData 4.0; SUMA_NETA Int64; facetas ausentes; anotación Common.Label; JSON numérico actual y soporte textual con IEEE754Compatible.

**Derivado del estándar:** Nullable efectivo true; facetas Precision/Scale no aplicables a Int64; precedencia de $format; dominio Int64 mayor que el entero seguro de Number.

**No comprobado:** distribución/rango global, presencia real de nulls fuera de la muestra, estabilidad entre peticiones, compatibilidad de unidades, contrato de otras métricas y cualquier formato real de ExportService. La ausencia de anotación de unidad en la propiedad no autoriza sumar unidades incompatibles.

**Aprobaciones requeridas:** negociación textual y perfil OData seguro; rechazo explícito fuera de rango frente a soporte BigInt; tratamiento del fallback sin contrato; política de salida si se necesitan enteros mayores que Number. No hay motivo para implementar un motor decimal general para SUMA_NETA ahora.

No se volvió a ejecutar Jest: esta etapa solo agregó documentación y realizó sondas de lectura/sintéticas. Las 139 pruebas corresponden a Etapa 2A y a la validación independiente informada por el usuario. Se revisaron Git y el diff para comprobar que no cambió producción.

Comandos de revisión local sin credenciales ni conexiones remotas:

```powershell
git status --short
git diff --check
rg -n 'response.json|IEEE754|exportUrl|createExportJob|toNumberSmart' src
```

Para repetir descubrimiento, usar el entorno autorizado con salidas saneadas, Bearer solo en memoria, GET de metadata y `$select=SUMA_NETA&$top=3`; no ejecutar ExportService ni los scripts manuales de pruebas sin revisar sus efectos y logging. El POST de autenticación debe dirigirse únicamente al endpoint OAuth configurado. No se incluyen credenciales, rutas privadas ni artefactos descargados en esta entrega.
