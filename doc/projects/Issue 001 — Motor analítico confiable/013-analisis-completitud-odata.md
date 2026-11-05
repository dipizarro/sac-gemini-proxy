# Issue 001 — Etapa 4A: completitud y paginación OData

Fecha: 2026-11-05. Base revisada: commit `7c19ad0`, rama `issue-motor-analitico-confiable`. Investigación y diseño; **no autoriza ni implementa 4B**.

## 1. Conclusión

El motor **no puede garantizar hoy la completitud** de las colecciones OData utilizadas en sus cálculos. La validación estructural y numérica funciona sobre las filas recibidas, pero no acredita que estén todas. Se reprodujo con respuestas sintéticas la publicación de un snapshot parcial y una respuesta de chat con `exact:true` y un total incompleto.

Recomiendo una política explícita por operación y un único recorrido paginado compartido por cargas completas y subconjuntos completos, preferentemente mediante continuación del servidor. Top N deliberado y conteo del servidor deben ser modalidades distintas. La completitud del recorrido y la consistencia temporal deben registrarse por separado: ninguna prueba realizada demuestra una fotografía transaccional de Datasphere.

## 2. Diagnóstico del código actual

Referencias relativas a la raíz del repositorio, verificadas en el commit revisado:

| Ruta / función / líneas | Comportamiento y consecuencia |
| --- | --- |
| `src/providers/ODataProvider.js:10,37–98`, fetchAllMovMatData | pageSize desde ODATA_PAGE_SIZE, default 1000; `$top=pageSize`, `$skip` incrementado en pageSize. Termina cuando `pageCount < pageSize`. No procesa nextLink, no solicita count ni orden. Una página corta puede cerrar prematuramente la carga. No valida que pageSize sea un entero positivo. |
| `src/providers/ODataProvider.js:123–179`, executeFilteredQuery | Un solo GET. Aplica filter/select/top/orderby; para count usa `$count=true&$top=0`. Para filas devuelve un array normalizado y descarta el envelope, incluido nextLink/count. Una selección sin top no equivale a resultado completo. |
| `src/services/DataService.js:84–132`, fetchMovMat | Un solo GET, top=50 por defecto. Conserva el envelope y nextLink si existe, pero no lo sigue ni marca LIMITED. `top:null` omite el parámetro, sin añadir paginación. Solo se encontró uso auxiliar en `src/test-data-service.js:10`; no se ejecutó ese script. |
| `src/services/ODataTransport.js:12–34` | Valida MIME/IEEE754, envelope, representación Int64 y count seguro cuando aparece. No valida nextLink, continuidad, número de filas frente a count, orden, duplicación ni límites globales de descarga. response.json() lee el cuerpo completo. |
| `src/services/ODataSchemaService.js:32–58,78–116` | Valida proyección/tipos y registra contexto; `full` significa selección de columnas, no colección completa. finish comprueba metadata, pero no cobertura de filas. copyContext conserva esquema, sin concepto de alcance/completitud. |
| `src/services/ODataMetadataService.js:8,64–88` | TTL de cinco minutos y hash de modelo. Revalidar CSDL no detecta inserciones, borrados o cambios de métricas sin cambio estructural. |
| `src/services/csdl/worker.js:224–242` | Valida referencias de Key, pero la salida normalizada no expone la lista de claves. No hay actualmente información de clave utilizable por el paginador sin ampliar ese contrato. No se modificó el lector. |
| `src/controllers/ChatController.js:40–49,53–166` | OData obtiene una única respuesta filtrada; no envía top ni orderby en esa llamada. Varias ramas declaran exact:true incondicionalmente tras calcular. El conteo de movimientos usa el número del servidor, no rows.length, en la rama OData. |
| `src/controllers/ChatController.js:169–365` | Comparaciones/insights usan las mismas filas de una sola respuesta. No todas llevan exact:true, pero presentan totales, diferencias, ganadores y análisis sin advertencia de incompletitud; algunos alimentan Gemini. |
| `src/services/DatasphereQueryBuilder.js:14–42,53–80` | Genera filtros para date/from/to/group/center y algunas proyecciones. No pagina ni genera orden único. year/months no se convierten en filtros: algunas comparaciones descargan una primera página más amplia y filtran localmente. |
| `src/services/QueryEngineService.js:10,41,133,174,243` | Conteos distintos, sumas, movimientos y rankings solo ven rows. El top de centros se aplica **después** de agrupar: necesita todas las filas del periodo, no los primeros N movimientos. |
| `src/services/InsightEngineService.js:8,57,83,168,211,250,304,361,412,491,520` | Actividad, meses/trimestres, conjuntos, sumas y volumen dependen de cobertura completa del periodo y de ambos lados de las comparaciones. Ausencias pueden aparentar cero actividad o materiales desaparecidos. |
| `src/services/SummaryService.js:11–57` | Sumas, promedios, extremos y percentiles sobre el array recibido, sin comprobación de cobertura. El sesgo de una página no se corrige con aritmética segura. |
| `src/services/DataService.js:135–198` | Publica después de validar; TTL de datos de 24 horas e invalidación conjunta de derivados. Un error de página rechaza la operación, pero una terminación corta aparentemente exitosa puede publicar un snapshot parcial válido estructuralmente. |

La estrategia se elige por DATA_SOURCE en QueryStrategyResolver; la ruta CSV del chat lee MOVMAT_DATA y la OData consulta el provider directamente. Por ello, añadir una guarda únicamente a la publicación en caché dejaría desprotegidas las consultas filtradas del chat y fetchMovMat. getInsights también necesita cobertura antes de construir contexto numérico.

## 3. Evidencia reproducida sin modificar código

Se ejecutó una sonda Node efímera con XML/JSON sintéticos, configuración y fetch sustituidos únicamente en memoria del proceso. Se utilizaron los servicios reales de metadata, esquema, provider, caché, cálculo y ChatController. No se agregaron archivos de prueba ni se llamó a SAP desde esta sonda.

| Caso sintético | Resultado observado |
| --- | --- |
| top=3; primera página de una fila, nextLink y count=2; segunda fila disponible en el escenario | Un único GET de datos; una fila publicada en MOVMAT_DATA. Suma 10 frente al total sintético 30. |
| Página corta sin nextLink, count=2 y una fila recibida | Carga aceptada; no se compara count con filas recuperadas. |
| pageSize=1; primera página repetida en el segundo offset; tercera vacía | Dos filas aceptadas; suma 20 frente a 30. El número de filas coincide con count=2, aunque falta la segunda clave lógica. |
| Consulta filtrada del chat con una fila y nextLink | Un GET, total 10 y `meta.exact:true`, frente a 30 para el subconjunto completo sintético. |
| fetchMovMat con una fila y nextLink | Una sola respuesta; nextLink queda en el envelope, sin recorrido ni estado de cobertura. |

Estos son **defectos confirmados con fixtures**, no pruebas de que el tenant haya devuelto totales erróneos. La repetición de página del fixture se conoce por cómo se construyó; comparar valores repetidos en datos reales no basta para afirmar duplicación.

## 4. Evidencia real acotada

Se efectuaron **cinco GET** al servicio configurado: uno de metadata y cuatro de datos. Un POST OAuth obtuvo el token; no hubo escritura de negocio. Datos y XML se procesaron solo en memoria. No se imprimieron valores, claves, namespaces privados, URLs, tokens ni cuerpos remotos.

Controles: HTTPS, redirects rechazados, timeout de 10 segundos por petición; límite de 2 MiB para metadata y 64 KiB para cada respuesta de datos. Las sondas de registros solicitaron dos filas y solo las columnas de la clave declarada. No se siguieron continuaciones ni se solicitó el dataset completo.

| Sonda | Resultado saneado |
| --- | --- |
| CSDL de la entidad configurada | Aceptado por CsdlReader. Key compuesta declarada de **tres propiedades escalares no nullable**. Nombres omitidos. |
| top=2, skip=0, select de clave y orderby de todos sus componentes asc | HTTP 200; 2 filas; sin nextLink ni count. |
| top=2, skip=2, misma selección/orden | HTTP 200; 2 filas; sin nextLink ni count. Sin coincidencias de tuplas seleccionadas con la primera página. |
| Repetición de top=2, skip=0 | HTTP 200; 2 filas; mismas tuplas seleccionadas que la primera petición. |
| count=true, top=0, select mínimo, filtro contradictorio de igualdad sobre FECHA | HTTP 200; 0 filas; @odata.count presente como string y valor cero; sin nextLink. |

Las cuatro respuestas de datos confirmaron OData 4.0 y JSON IEEE754Compatible=true; no presentaron ETag ni Preference-Applied. No se pidió una preferencia de tamaño ni aislamiento: la ausencia de esos headers no demuestra falta de soporte.

Interpretación limitada:

- El activo aceptó top/skip/orderby y un count **filtrado vacío**, no un conteo global costoso. No se midió coste ni cardinalidad del activo.
- La clave CSDL es una candidata declarada para orden total. La muestra distingue cuatro tuplas y muestra repetibilidad inmediata, pero **no verifica unicidad global ni estabilidad ante modificaciones**. No autoriza deduplicación automática.
- No se observó nextLink con paginación explícita del cliente, compatible con la documentación SAP. **No se determinó experimentalmente si una respuesta no limitada del activo produce nextLink**, ni el comportamiento de sus tokens.
- No se forzó un límite de bytes, no se recorrió una cadena completa, no se comprobó replicación/lineage ni aislamiento transaccional.

Pendiente controlado: sobre una colección de prueba estable o un filtro cuya cardinalidad/coste se hayan acordado, verificar una respuesta sin top/skip con preferencia pequeña, presupuesto de bytes/filas y máximo dos páginas. La preferencia no es garantía de límite; cancelar al exceder presupuesto. Probar continuación e IEEE754 sin modificar el enlace y, separadamente, soporte de snapshot isolation. No ejecutar esta ampliación contra el activo completo como parte de 4A.

## 5. Mecanismos y restricciones documentadas

SAP documenta límites de respuesta además del número de filas y advierte que nextLink puede faltar con paginación del cliente; una respuesta menor que la solicitada no acredita agotamiento. No se puede forzar toda la colección en una página. [SAP KBA 3337495](https://userapps.support.sap.com/sap/support/knowledge/en/3337495).

El manual consultado, versión 2026.22 (20-10-2026), muestra para el servicio relacional 50 KB por defecto (hasta 50.000 registros) y 100 KB máximos (hasta 100.000), páginas 30–31. Son límites documentados, **no medidos en este tenant**. No extrapolar el default de diez resultados del catálogo al endpoint relacional. $count no se admite en solicitudes analíticas. Si alguna fuente del lineage no está replicada, el manual restringe count/top/skip y el vocabulario de filtros; las anotaciones también pueden restringir opciones. La aceptación de nuestras sondas no certifica todo el lineage ni su estado futuro. [SAP, Consuming Data Exposed by SAP Datasphere](https://help.sap.com/doc/f8cf57fada6b446c839a252c7c7d8324/cloud/en-US/f4fd00b1962a4bf8917cc9165651095c.pdf).

OData define nextLink opaco, sin añadir opciones de sistema; permite que el servicio ignore el tamaño preferido. top limita el resultado solicitado y skip omite posiciones; el protocolo exige orden estable para estas opciones. count corresponde al filtro y no se reduce por top/skip, pero no asegura igualdad con una enumeración cambiante. OData-Isolation:snapshot define una garantía entre páginas si está soportada; no se verificó aquí. [OASIS OData 4.0, §§8.2.6, 11.2.5.3–7](https://docs.oasis-open.org/odata/odata/v4.0/errata03/os/complete/part1-protocol/odata-v4.0-errata03-os-part1-protocol-complete.html).

No se encontró una cuota numérica de peticiones aplicable y comprobada para este tenant. No inventar un requests/segundo. Rate limiting, timeout y reintentos deben tratarse como límites operativos, no como señal de fin.

## 6. Matriz de operaciones

“Exacto” en esta tabla significa cobertura suficiente para el alcance declarado; sigue requiriendo calidad numérica y una política de consistencia temporal.

| Operación | Alcance necesario | Top N deliberado / count | Mecanismo actual | Exactitud y efecto de omisiones |
| --- | --- | --- | --- | --- |
| Carga MOVMAT_DATA / reload | Colección completa | No / no | top+skip hasta página corta | No garantizada; parcial puede quedar cacheado y alimentar índices/perfiles. |
| getInsights / resumen enriquecido / estadísticas | Colección completa o periodo explícito completo | Top de salida, no límite de entrada | Carga completa actual o array recibido | Sumas, medias, percentiles y ranking sesgados. |
| Suma por fecha/grupo | Subconjunto filtrado completo | Top de centros después de sumar | Un GET filtrado | exact:true actual no justificado; faltantes con signo negativo incluso pueden inflar el total. |
| Centros distintos por fecha/rango | Subconjunto completo | No | Un GET filtrado | Subconteo posible; repetición de una fila no siempre altera distinct, pero omisiones sí. |
| Top centros por movimientos | Todos los movimientos del periodo | Top N **de grupos** | Un GET + agrupación local + slice | No equivale a pedir top N filas; puede cambiar el ganador. |
| Movimientos por fecha, estrategia OData | Escalar de count para el filtro | count del servidor | top=0/count=true | No necesita descargar filas; exactitud como conteo reportado para ese alcance/momento, no garantía de snapshot de otra consulta. |
| Movimientos contados localmente | Subconjunto completo | No | rows.length/filtro local | No sustituir silenciosamente count fallido por longitud de página. |
| Actividad mensual, trimestre, máximo diario, priorización | Periodo completo | Top de salida opcional | Un GET; varios filtros temporales son locales | Meses/días pueden parecer vacíos; comparaciones no confiables. |
| Comparaciones de suma/volumen entre meses | Unión completa de ambos periodos | No | Un GET + cálculo local | Totales, diferencia y ganador incorrectos aun con números válidos. |
| Diferencias de centros/materiales y grupos | Ambos conjuntos completos | Muestras de salida | Un GET + conjuntos locales | Falsas bajas/altas o materiales “sin movimientos”. |
| executeFilteredQuery con top explícito | Primeros N registros según un orden definido | Sí | Un GET | LIMITED respecto de la colección; ni siquiera garantiza N si la respuesta fue truncada antes. |
| fetchMovMat default top=50 | Muestra/página limitada | Sí | Un GET, envelope conservado | No debe alimentar totales globales; con top=null sigue sin garantía de completitud. |

Las muestras de evidencia `slice(0,5/10/20)` posteriores al cálculo no son defectos de completitud por sí mismas. Limitar la presentación es distinto de limitar las filas antes de agregar.

## 7. Comparación y estrategia recomendada

| Alternativa | Ventaja | Límite / decisión |
| --- | --- | --- |
| Continuación del servidor | Delega fronteras y tokens al servicio | Preferida para complete collection/subset; falta confirmar una cadena real del activo. No asumir que implica snapshot. |
| top/skip sin count | Fácil de instrumentar | Página corta o falta de nextLink no bastan; por defecto INDETERMINATE para este activo si no existe otra evidencia de terminación. |
| top/skip con count y orden por clave | Permite contrastar cobertura y avance | Fallback explícito, no automático. Necesita soporte confirmado, clave/orden y política de fuente estable; count coincidente no detecta reemplazos compensados. |
| Keyset/rango de clave | Evita algunos desplazamientos de offsets | No introducir ahora: clave compuesta, orden y filtros requieren contrato y soporte adicionales. |
| Agregación remota | Puede evitar descargar filas para algunas métricas | count es una capacidad ya sondeada; sumas/agrupaciones remotas no están verificadas ni aprobadas. |

Propuesta para 4B, pendiente de aprobación:

1. **Modalidad explícita**: COMPLETE_COLLECTION, COMPLETE_FILTERED, SERVER_COUNT o TOP_N. Nunca deducir el propósito solo por recibir un array o por la ausencia de top.
2. **Completo mediante servidor**: primera petición sin top/skip artificiales, con filtro/proyección correctos y formato aprobado. Preferencia de tamaño solo como ayuda operativa. Seguir cada nextLink válido hasta terminación, sin considerar la longitud de página como fin. Habilitar la modalidad para el activo bajo el contrato de servicio y la comprobación pendiente; sin esa confianza, INDETERMINATE.
3. **Fallback offset opt-in**: conservar filtro/proyección/orden por clave y avanzar el offset por **filas efectivamente recibidas**, no por el tamaño pedido cuando la página resulte corta. Continuar mientras falten filas respecto del count verificado; una página vacía antes de alcanzarlo es inconsistencia. Si el servidor también devuelve nextLink, respetar esa continuación sin inventar simultáneamente un offset; no mezclar modos sin regla probada.
4. **Conteo**: obtener solo count del mismo filtro y validar su representación segura. Si no está disponible, error de capacidad o nuevo recorrido completo aprobado; nunca usar una página como sustituto. El conteo inicial/final es diagnóstico, no aislamiento.
5. **Top N**: límite global deliberado, no tamaño de página; completar hasta N mediante nextLink si corresponde y es seguro, o hasta agotamiento respaldado. Marcar LIMITED respecto de la colección aunque N filas sean correctas. Requiere orden total para hablar de “los primeros”; top de grupos sigue necesitando todos los movimientos o agregación remota validada.

Con offset, una clave declarada es evidencia de identidad, no una auditoría de unicidad. Proponer exponer en una futura versión del modelo CSDL las referencias de Key **ya validadas**, bajo aprobación específica. No modificar el lector en 4A ni duplicar un extractor XML en producción. No hacer deduplicación por hash de filas completas: dos movimientos distintos pueden ser idénticos en las columnas seleccionadas. Una clave repetida durante un recorrido que debería ser único invalida la lectura; no borrar la fila y continuar como si el resultado fuera exacto.

## 8. Continuaciones seguras y presupuestos

Diseño propuesto, no implementado:

- Resolver enlaces relativos contra la URL de respuesta autorizada; exigir HTTPS, mismo origin exacto (host y puerto), misma ruta canónica de la entidad configurada y ausencia de usuario/password/fragmento. Rechazar rutas ambiguas, separadores codificados, credenciales incrustadas y salida del activo. Solo después adjuntar Bearer. Un origin parecido, otro puerto, metadata o una ruta de navegación no están autorizados por compartir hostname.
- `redirect:error` también para datos/continuaciones. No seguir redirecciones ni enviar tokens a un destino nuevo. No descargar enlaces encontrados en anotaciones arbitrarias.
- Tratar la query como opaca: no añadir top, skip, filter, count, select, format ni reconstruir skiptoken. Conservar Accept IEEE754Compatible; validar cada respuesta con ODataTransport. Si el enlace impone un formato incompatible, fallar en vez de corregirlo silenciosamente.
- Detectar ciclos con un conjunto de URLs absolutas resueltas; almacenar enlaces solo en memoria, sin logs. Un presupuesto total cubre variantes que evadan igualdad textual mediante cambios irrelevantes. Un token agotado/invalidado requiere fallo, no reinicio invisible que mezcle capturas.
- Presupuestos iniciales a aprobar, **no derivados del volumen del negocio**: 1.000 páginas, 100.000 filas acumuladas, 2 MiB descomprimidos por respuesta, 64 MiB acumulados, 120 segundos globales y 15 segundos por petición, limitado por el tiempo restante. Controlar stream antes de JSON.parse y acumulación antes de publicar. Si son insuficientes para un caso legítimo, aumentar por decisión explícita o diseñar otra vía; no etiquetar como completo al alcanzar el límite.
- Reintentos automáticos deshabilitados inicialmente. Una futura política acotada debe repetir la misma petición sin duplicar una página ya aceptada y sin prolongar el presupuesto; observar Retry-After sin esperas ilimitadas.

El límite de seguridad termina como INDETERMINATE/operación no publicable, nunca como un Top N deliberado. Errores HTTP, de transporte, esquema, ciclos o continuidad contradictoria son FAILED. No exponer los acumulados parciales a consumidores analíticos.

## 9. Completitud y consistencia: política de exactitud

Contexto interno recomendado, separado del esquema: estado, alcance/filtro/proyección, modalidad, motivo de terminación, páginas/filas/bytes, intervalo de lectura, referencia interna al snapshot y evidencia de count/clave. No serializar filtros, claves o URLs privadas por defecto. Registrar además `consistency: VERIFIED_SNAPSHOT | VERIFIED_STATIC_SOURCE | UNVERIFIED`.

| Estado | Significado / uso |
| --- | --- |
| COMPLETE | Se agotó un recorrido respaldado para el alcance declarado y pasaron las verificaciones disponibles. No equivale por sí solo a consistencia transaccional. |
| LIMITED | Se aplicó un límite deliberado. Útil para muestras o una lista Top N bien definida; no acredita totales globales. |
| INDETERMINATE | Falta evidencia de fin, se alcanzó un presupuesto o no puede establecerse cobertura. Bloquear agregados declarados completos. |
| FAILED | Error invalida la operación. No publicar filas parciales ni generar una respuesta numérica exitosa. |

Recomendación: conservar estos estados inicialmente en contexto interno; evitar un cambio indiscriminado de JSON. Las operaciones que requieren cobertura completa deben exigir COMPLETE **antes de calcular**, incluidos conteos locales y respuestas de cero. Para mantener `meta.exact:true` como afirmación fuerte, exigir además calidad válida, alcance correcto y consistencia respaldada; si esta última es UNVERIFIED, no prometer un total de una fotografía transaccional. Aprobar si se permite mostrar una captura completa no transaccional con advertencia explícita y sin esa afirmación de exactitud, o si se bloquea su respuesta numérica.

Un SERVER_COUNT válido puede devolverse como conteo reportado del filtro en esa solicitud; no certifica los registros de otra lectura ni la actualidad del sistema origen. Replicación, permisos y filtros definen qué colección fue contada.

Una copia íntegra puede heredar estado/alcance mediante transferencia explícita. Un filtro local de un COMPLETE puede ser completo para el **nuevo** alcance si la transformación está definida y conserva los campos necesarios. Un slice de muestra pasa a LIMITED; no heredar ciegamente COMPLETE. Clones sin registro no adquieren cobertura ni contrato por semejanza de contenido.

## 10. Escenarios, errores y protección de caché

| Escenario | Comportamiento recomendado |
| --- | --- |
| Página menor que top con registros posteriores | Continuar por enlace autorizado o política offset respaldada; no finalizar por longitud. |
| nextLink presente | Validar destino/ciclo/presupuesto; seguirlo opacamente. |
| nextLink ausente | Solo es terminal bajo el modo/contrato de servicio aplicable; con top explícito no acredita colección completa. |
| Página repetida | Con identidad verificable detectar repetición y fallar; sin ella, sospecha/INDETERMINATE, no deduplicar valores. |
| Registros legítimamente repetidos | Conservar multiplicidad; igualdad de columnas no es identidad de movimiento. |
| Omisiones entre páginas | Detectar cuando count, claves o fronteras lo permiten; sin evidencia, no prometer detección universal. |
| Cambios durante lectura | Un hash CSDL constante no los detecta. Divergencias observadas invalidan; cambios compensados pueden escapar aun con count coincidente. |
| Error después de páginas válidas | FAILED; descartar candidato, conservar snapshot anterior vigente. |
| Consulta filtrada solo primeros N | LIMITED/INDETERMINATE según propósito; impedir total/ganador exacto. |
| Count distinto de filas | Si alcance completo comparable, rechazar; en Top N es esperable que sea mayor. |
| Count no disponible | Continuación del servidor puede aportar cobertura; offset sin otra evidencia no se eleva a COMPLETE. |
| Presupuesto agotado | INDETERMINATE con razón de límite; no publicar como éxito parcial ni LIMIT deliberado. |

Proponer errores específicos saneados de completitud/continuación, manteniendo el envelope existente: ODATA_COMPLETENESS_ERROR con razones NEXT_LINK_REJECTED, CONTINUATION_CYCLE, COUNT_MISMATCH, DUPLICATE_ENTITY, INCOMPLETE_RESULT, SAFETY_LIMIT o CONSISTENCY_UNVERIFIED. Diferenciar incompatibilidad de respuesta (502 propuesto) de imposibilidad operativa temporal/presupuesto (503 propuesto). Conservar códigos de transporte, metadata y calidad anteriores. Estados HTTP y exposición de status requieren aprobación; no usar 422 para un dataset interno incompleto.

DataService debe exigir el contexto de cobertura al publicar MOVMAT_DATA, además del estructural, sin modificar su coherencia atómica. Nada de invalidar derivados o extender TTL durante una descarga incompleta; éxito completo reemplaza dataset/índice/perfil de forma coordinada. Falla de reload no debe responder éxito con el snapshot viejo. Leer el anterior es válido hasta su vencimiento original. No activar EXPORT por fallos de completitud. Una entrada preexistente sin evidencia de cobertura no debe promoverse automáticamente a COMPLETE al desplegar 4B.

## 11. Matriz de pruebas y aceptación para 4B

Todas las pruebas nuevas usarán XML/JSON sintéticos y conservarán las 286 actuales.

| Prueba propuesta | Resultado exigido |
| --- | --- |
| Tres páginas con nextLink, última sin enlace | COMPLETE del alcance; todas las filas una sola vez. |
| Página corta con nextLink | Continuar; no publicar primera página. |
| Página corta sin enlace en modo offset, count mayor | Continuar según política aprobada o INDETERMINATE; nunca éxito por longitud. |
| Enlace relativo válido | Mismo destino autorizado; no alterar query ni formato. |
| Enlace circular, repetido, otro host/puerto, downgrade, credenciales, ruta ajena o redirect | Rechazo antes de enviar Bearer; ningún acceso al destino prohibido. |
| nextLink con transporte posterior incompatible | Error existente de transporte; no reparar la URL silenciosamente. |
| Count coincidente/divergente/no soportado | Evidencia registrada; divergencia rechazada; ausencia no reemplazada por longitud de página. |
| Colección vacía con terminación respaldada | COMPLETE vacío, permite cero; vacío ambiguo no se eleva automáticamente. |
| Error de página intermedia / token vencido | Candidato descartado; snapshot/derivados/TTL anteriores intactos. |
| Clave repetida y otra omitida, count coincidente | No declarar exactitud por mera igualdad de count. |
| Filas iguales con identidades distintas | Conservar ambas; sin deduplicación por contenido. |
| Inserciones/borrados entre offsets | Detectar casos observables; documentar limitación de cambios compensados. |
| Top N en varias páginas | Respetar límite global y orden; LIMITED para colección, sin transformar filas en top de grupos. |
| Filter/select/orderby constantes durante offsets | Alcance idéntico; incluir claves internas necesarias sin alterar columnas públicas sin aprobación. |
| Cambio de CSDL entre páginas | Mantener rechazo estructural actual; no confundirlo con detección de cambios de datos. |
| Máximos de páginas/filas/bytes/duración | Abortos verificables, sin publicación parcial y sin crecimiento ilimitado. |
| Copia/filtrado/slice con contexto | Transferencia explícita y estado correcto del nuevo alcance; conservar perfiles numéricos. |
| Chat sumas, distinct, comparaciones y rankings sobre parcial | Sin exact:true, sin ganador/total global inventado y sin enviar cifras parciales a Gemini como completas. |

Criterio central: ningún éxito estructural, count coincidente o ausencia aislada de nextLink basta para elevar una captura a resultado global exacto. La prueba de regresión de chat reproducida en 4A debe fallar antes de 4B y pasar tras su guarda de cobertura.

## 12. Decisiones pendientes y cierre de investigación

Requieren aprobación antes de implementar:

1. Modalidades explícitas y continuación del servidor como primera estrategia, con la verificación controlada pendiente del activo.
2. Condiciones de habilitación del fallback offset, política de fuente estable y uso de count.
3. Exposición mínima futura de las claves ya validadas en el modelo CSDL; no hardcodear sus nombres privados ni inventar una clave con dimensiones.
4. Política de `exact:true` frente a COMPLETE con consistencia no verificada; presentación honesta o bloqueo de esas operaciones.
5. Presupuestos/reintentos, nuevos errores HTTP y tratamiento de snapshots antiguos sin evidencia de cobertura.
6. Alcance de contexto/transferencias y preservación de interfaces públicas. Un recorrido compartido pequeño es suficiente; no se propone un framework de sincronización o deduplicación.

Verificación final: **286/286 pruebas aprobadas, 13 suites**, ejecución real de `node node_modules/jest/bin/jest.js --runInBand --silent --cache=false`. Se revisaron Git, código y documentación primaria; se ejecutaron las sondas descritas y `git diff --check`. No se modificaron código productivo, tests, dependencias, credenciales, caché, contratos ni CSDL. Único archivo nuevo: este documento. Sin commit ni push. **No se avanzó a 4B.**
