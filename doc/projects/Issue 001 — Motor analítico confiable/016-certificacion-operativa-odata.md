# Issue 001 — Etapa 4C: certificación operativa de OData

Fecha: 2026-11-11. Base revisada: `1c5250f`, rama `issue-motor-analitico-confiable`. Git estaba limpio al comenzar. Investigación, pruebas sintéticas y dictamen; **sin activación ni cambios de producción**.

## 1. Dictamen

**No activar la continuación y no dar por cerrado Issue 001 como motor OData operativo certificado.** Las protecciones locales pasan sus pruebas, pero falta una cadena real de continuación sobre un subconjunto seguro y existe una divergencia semántica reproducida en `sumSumaNetaByGroupAndDate`.

El usuario confirmó que **no dispone de un subconjunto no vacío previamente acotado ni de una colección de prueba controlada**. Por esa condición, P03–P05 se detuvieron antes de enviar solicitudes. Esta etapa realizó **cero solicitudes al tenant**, incluidas autenticación, metadata y count. No se exploró la colección ni se eligió una fecha o dimensión por intuición.

La continuación permanece `false`. SERVER_COUNT conserva su política anterior; ello no equivale a certificar ahora todos los filtros o la disponibilidad actual del servicio.

## 2. Fase 1: regresión local y revisión de consumidores

| Ejecución real | Resultado |
| --- | --- |
| Baseline, antes de añadir pruebas | **397/397**, 15 suites, 22,941 s. |
| Caracterización semántica aislada | **10/10**, 1 suite, 2,294 s. |
| Suite completa final | **408/408**, 16 suites, 22,960 s. |

No hubo fallos de Jest en estas ejecuciones. Los diez tests semánticos son **caracterizaciones del comportamiento actual y de su diferencia respecto del contrato propuesto**; sus éxitos no certifican equivalencia ni constituyen una corrección productiva. Se agregó además un caso funcional de comparación sin certificación. Los 397 casos anteriores se conservaron, sin cambiar expectativas ni omitir tests.

Revisión estática del código actual:

| Ruta y referencia | Evidencia |
| --- | --- |
| `src/services/ODataCapabilities.js`, `forConfiguredAsset` | `continuationSupported:false`, `serverCount:true`; no se modificó. |
| `src/providers/ODataProvider.js:9`, `traverse` | Bloquea modalidades completas sin certificación antes de cargar datos. `loadData` y consultas filtradas delegan al paginador. |
| `src/services/ODataPaginationService.js:147–169` | Sigue nextLink; la terminación sin enlace exige respaldo. TOP_N y SERVER_COUNT son modalidades independientes. No termina por longitud corta de página. |
| `src/services/ODataCoverageService.js:12`, `requireComplete` | Colección completa por defecto; subconjunto solo con descriptor privado correspondiente al solicitado. |
| `src/services/DataService.js`, `fetchMovMat`, `getRowsCached`, `_loadRows` | Lectura paginada, colección explícita para MOVMAT_DATA bajo fuente OData y validación antes de publicar. |
| `src/controllers/ChatController.js:38–72` | Separa ayuda de analítica; OData usa `exact:false` y UNVERIFIED. El `exact:true` encontrado corresponde a la rama no OData/CSV. |
| QueryEngineService, InsightEngineService, SummaryService e índices/perfiles | Guardas de cobertura previas a cálculos, según las pruebas de integración. |

La búsqueda en `src` no encontró el antiguo `pageCount`, `hasMoreData`, `$skip` ni `ODATA_PAGE_SIZE`. No se identificó una ruta productiva reintroducida de descarga por página corta o publicación de parciales. Esta conclusión es de revisión local y pruebas sintéticas, no una observación de producción.

## 3. Fase 2: selección de subconjunto y límite de investigación

Se revisó la evidencia de 013, 014 y 015. Solo consta un filtro contradictorio de cardinalidad cero y muestras históricas limitadas con paginación explícita del cliente. No existe en esos documentos un filtro no vacío cuya cardinalidad y coste estén verificados para esta prueba.

Una muestra histórica de pocas filas no acredita el coste de un filtro nuevo ni la cardinalidad de una fecha/grupo. Tampoco se puede derivar de un CSV local que SAP tenga el mismo contenido, permisos, actualización o plan de consulta. No se utilizaron esos supuestos para sondear el servicio.

Se solicitó al usuario un subconjunto acotado o colección controlada; respondió **«no»**. Al faltar el requisito de seguridad, se detuvieron las sondas. No es un fallo de conectividad, autorización, HTTP o count: **no se intentaron esas operaciones**. No hay un código HTTP actual que registrar.

Para desbloquear la prueba se necesita un filtro suministrado/verificado por el responsable del activo, evidencia de cardinalidad pequeña no nula y coste aceptable, o una colección de prueba estable. El filtro y los valores privados deberán manejarse fuera del documento público y sin volcados de registros.

## 4. Fase 3: P03, P04 y P05

| Prueba | Estado en 4C | Motivo / resultado |
| --- | --- | --- |
| P03 — count=true, top=0 sobre subconjunto | **BLOQUEADA, no ejecutada** | No hay filtro no vacío seguro ni coste conocido. No se solicitó count global. |
| P04 — primera página sin top/skip, solo claves CSDL | **BLOQUEADA, no ejecutada** | Depende de P03 y de la selección segura. |
| P05 — seguir un nextLink | **BLOQUEADA, no ejecutada** | No hay P04 ni enlace real observado en esta etapa. |

No se deben llenar las columnas HTTP, filas, bytes, nextLink, transporte o estructura con ceros de una respuesta inexistente. El número de solicitudes realizadas sí es cero; los resultados remotos son **no observados**.

### Controles que deberán conservarse cuando se desbloquee la sonda

- P03 limitado al filtro acordado: HTTP 200, JSON IEEE754Compatible, count canónico seguro y cardinalidad apta. Un count inválido, no disponible o demasiado grande detiene el procedimiento.
- Presupuesto global de 45 s; 10 s por petición sin superar el remanente; 64 KiB por respuesta, 128 KiB acumulados; máximo dos páginas de datos. No ampliar límites para conseguir un resultado.
- P04 sin top/skip, con proyección mínima de claves declaradas y resueltas desde el CSDL del activo. La preferencia de tamaño de página, si se usa, no será una garantía de límite.
- GET autenticado, redirects rechazados, cuerpo descomprimido acotado antes de interpretar JSON; validación del transporte y tipos.
- P05 únicamente ante enlace válido: HTTPS, origin y ruta exactos del activo; URL opaca sin reconstruir parámetros, mismo Accept compatible y autenticación. Validar antes de enviar credenciales.
- Comparar en memoria las tuplas de claves de ambas páginas para repeticiones observables. No imprimirlas ni deduplicar por igualdad de valores. Si la segunda página contiene nextLink, detenerse: el recorrido continúa incompleto bajo el límite autorizado.
- Registrar solo estados, contadores, bytes, presencia de continuación, conformidad de transporte y errores estructurales saneados. No publicar URLs, claves, XML, cuerpos ni tokens.

Estos controles son el procedimiento pendiente, **no controles ejercitados contra el tenant en 4C**. Una respuesta de una página sin nextLink no probaría ausencia de soporte de continuación. Una cadena de dos páginas aún abierta no acreditaría agotamiento.

### Evidencia real histórica, separada de la actual

Según 013, el 2026-11-05 hubo un count filtrado contradictorio con HTTP 200, array vacío y count textual cero, conforme al transporte IEEE754. Según 014, el mismo alcance vacío sin top/skip devolvió HTTP 200, cero filas, 192 bytes y ningún nextLink; se solicitaron las tres claves declaradas. Ninguna observación mostró una cadena no vacía real. Estos antecedentes no se reejecutaron ahora y no certifican actualidad, coste o semántica de otros filtros.

## 5. Fase 4: equivalencia semántica de grupos

### Defecto reproducido

`ODataQueryScope.filter` emite `GRUPO_ARTICULOS eq '<literal escapado>'`, preservando mayúsculas y espacios del literal. En cambio, `QueryEngineService.sumSumaNetaByGroupAndDate`:

1. Aplica trim y toUpperCase al argumento y al grupo de cada fila.
2. Acepta `rowGroup.includes(targetGroup) || targetGroup.includes(rowGroup)`.
3. Convierte grupos null/vacíos a cadena vacía, que satisface la segunda condición para cualquier grupo buscado.

Por tanto, una misma operación puede sumar filas distintas según reciba una colección completa o un subconjunto filtrado mediante igualdad. La protección de cobertura verifica el alcance declarado, pero no elimina esta diferencia en el predicado local.

### Matriz ejecutada — solo valores sintéticos

Consulta de grupo `GRUPO`, fecha sintética común, valor 10 por fila:

| Grupo de la fila | Suma actual sobre colección completa | Suma de igualdad literal propuesta / servidor sintético filtrado |
| --- | ---: | ---: |
| `GRUPO` | 10 | 10 |
| `PRE_GRUPO` | 10 | 0 |
| `GRUPO_POST` | 10 | 0 |
| `grupo` | 10 | 0 |
| ` GRUPO ` | 10 | 0 |
| `OTRO` — grupo solicitado inexistente | 0 | 0 |
| `GRU` — nombre contenido en el solicitado | 10 | 0 |
| Cadena vacía | 10 | 0 |
| null | 10 | 0 |

Caso combinado: grupos `GRUPO`, `PRE_GRUPO`, `GRUPO_POST`, `GRU`, `OTRO` con importes sintéticos 10, 20, 30, 40 y 50. El motor actual sobre colección completa suma **100 en cuatro filas**; el contrato literal suma **10 en una fila**. Se ejecutaron ambos caminos con el provider, paginador, validación estructural, contexto de cobertura y parser Int64 reales, sobre XML/JSON mockeados.

El mock de servidor utiliza deliberadamente igualdad literal. **No se midió la collation de SAP ni se afirma que `eq` remoto sea idéntico a `===` de JavaScript para mayúsculas, espacios o Unicode.** Lo confirmado es el predicado parcial del motor y su divergencia respecto del contrato literal propuesto y del filtro generado. La comparación real entre ambos orígenes sigue pendiente de datos controlados.

### Recomendación que requiere aprobación

Adoptar **igualdad literal exacta para OData** en esta operación:

- Comparar el valor textual de GRUPO_ARTICULOS con el grupo acreditado, sin includes, trim ni cambio de mayúsculas.
- Excluir null y cadena vacía de la coincidencia con un grupo válido.
- Preservar el literal acreditado en el resultado, sin mostrarlo transformado a mayúsculas como si fuera la identidad consultada.
- Mantener por ahora el comportamiento CSV aprobado. La rama estricta se seleccionaría por procedencia OData registrada, no por forma de los valores ni por inferencia por celda.
- Conservar la generación y escape del literal en ODataQueryScope; no introducir tolower/trim remoto sin verificación de soporte y semántica.

Cambio mínimo propuesto: rama de comparación y presentación del grupo en `sumSumaNetaByGroupAndDate`, reutilizando la procedencia existente; ajustar las expectativas OData de esta matriz para exigir paridad de 10/0 entre colección y subconjunto. No modificar parser numérico, cobertura ni CSV.

Alternativas no recomendadas ahora: llevar la coincidencia parcial al servidor amplía grupos potencialmente ambiguos y perpetúa el caso vacío; normalizar ambos lados exige una decisión de negocio y verificar collation/funciones remotas. Ninguna es necesaria para un contrato de identidad de grupo explícito.

**No se implementó la propuesta.** Las pruebas añadidas caracterizan el defecto y serán una base para las futuras regresiones de paridad; no deben conservarse como aprobación permanente del includes cuando se autorice el cambio. La semántica remota deberá comprobarse por separado y una discrepancia no deberá ocultarse como éxito exacto.

## 6. Fase 5: pruebas funcionales

Todos los resultados de esta tabla son **locales, con respuestas sintéticas**; no representan pruebas funcionales actuales del tenant.

| Caso | Evidencia / resultado |
| --- | --- |
| Pregunta general | ODataCompleteness: ayuda HTTP 200, sin descarga ni generación numérica con Gemini. |
| Suma sin certificación | HTTP 503, sin total parcial ni envío de cifras a Gemini. |
| Comparación sin certificación | Nueva regresión 4C: HTTP 503 / CONTINUATION_UNCERTIFIED antes de fetch y Gemini. |
| SERVER_COUNT | Count validado, respuesta reportada, exact=false. |
| TOP_N | LIMITED; bloqueado para sumas globales y otros agregados. |
| Segunda página fallida | Rechazo sin entregar parcial; errores saneados. |
| Caché | Pruebas conservan identidad de dataset, índice, perfil y entradas con TTL original tras fallo de recarga. Solo cachés de procesos de prueba. |
| Snapshot vacío | Cero en alcance acreditado; otra fecha o falta de cobertura se rechaza. |
| Cambio de metadata | ODataSchema verifica incompatibilidad durante carga y fracaso de revalidación; no se publica candidato. |
| CSV | Suites numéricas, estructurales, endpoints y ciclo de carga anteriores permanecen aprobadas. |

ODataCapabilities, CSDL, metadata, transporte, configuración y caché de producción no se modificaron. La consistencia temporal sigue UNVERIFIED en las respuestas OData. Los mocks de capacidad certificada se limitan a los procesos de test.

## 7. Capacidades: clasificación separada

| Capacidad | Dictamen | Alcance de la evidencia |
| --- | --- | --- |
| SERVICIO_COUNT | **VERIFICADO históricamente, con alcance restringido** | Solo count filtrado vacío de 013. No revalidado en 4C ni certificado para un subconjunto no vacío. No hay certificación general por el flag serverCount=true. |
| SERVICIO_NEXTLINK | **INCONCLUSO / NO CERTIFICADO** | No se observó una cadena real segura. La ausencia histórica de enlace en una consulta vacía no prueba falta de soporte. |
| RECORRIDO_MULTIPAGINA | **NO VERIFICADO en el servicio real** | Motor y controles verificados con fixtures, no con una cadena real del activo. |
| COMPLETITUD_POR_ALCANCE | **NO ACREDITADA operativamente para el activo** | Las guardas y contratos explícitos pasan pruebas locales; falta evidencia remota y resolver la semántica de grupos. |
| CONSISTENCIA_TEMPORAL | **NO VERIFICADA** | No hay evidencia independiente de snapshot transaccional. |
| SEMANTICA_DE_GRUPOS | **REQUIERE AJUSTE** | Divergencia sintética reproducida; collation remota no comprobada. |

No activar continuationSupported ni reinterpretar COMPLETE como garantía transaccional. El Issue puede mantener aprobados sus componentes defensivos, pero eso no equivale a cerrar la certificación operativa.

## 8. Riesgos, alternativa futura y criterios de cierre

### Riesgos residuales

- No hay medición actual de conectividad, HTTP, count no vacío, coste, repetición de claves o continuación del activo.
- La clave declarada en CSDL no prueba por sí sola unicidad efectiva ni estabilidad temporal. No publicar claves ni deduplicar heurísticamente.
- Count coincidente y esquema constante no detectan todas las omisiones/duplicaciones compensadas o cambios entre páginas.
- Los límites de dos páginas pueden detener una prueba legítima antes del final. Ese resultado debe permanecer no acreditado, nunca ampliarse automáticamente.
- El filtro local parcial puede incluir otros grupos, incluidos vacíos/nulos, aun con datos estructural y numéricamente válidos. No liberar sumas por grupo con esa divergencia.

### Alternativa futura por offset — solo evaluación

Si una prueba segura futura no permite observar continuación, evaluar una modalidad explícita top/skip/count. **No recomendarla como fallback inmediato:** todavía no hay evidencia de que el servicio carezca de nextLink.

Requisitos previos: soporte real de count para el alcance; claves declaradas y verificadas utilizables; orden total estable por todas las claves; filtro/proyección invariantes; políticas de inserciones/borrados/cambios durante lectura; detección observable de repeticiones y discrepancias de count; presupuestos y terminación sin depender de página corta. Sin una estrategia temporal respaldada, offset tampoco certifica snapshot ni exactitud. La alternativa requiere aprobación de diseño y pruebas antes de implementarse.

### Pendientes para cerrar Issue 001

1. Aprobar la semántica literal OData propuesta y su alcance respecto de CSV; implementar el cambio mínimo en una etapa autorizada y exigir paridad de la matriz semántica.
2. Obtener un subconjunto no vacío seguro y evidencia de coste/cardinalidad; desbloquear P03–P05 sin aumentar presupuestos.
3. Observar y validar una cadena real, incluyendo destino opaco, transporte, tipos, identidad, terminación y count comparable. Si hay más de dos páginas, detenerse y acordar otro subconjunto o una autorización posterior.
4. Verificar la semántica de igualdad remota con casos controlados de mayúsculas/espacios y grupos solapados; no inferirla de la sintaxis eq.
5. Emitir un dictamen nuevo, acotado al activo y operación verificados. Aprobar separadamente cualquier activación o alternativa de offset.
6. Conservar UNVERIFIED y exact=false mientras no exista evidencia temporal independiente; acordar qué garantía de cierre se acepta bajo ese límite.
7. Reejecutar regresiones y comprobar activación controlada solo después de la aprobación correspondiente.

## 9. Artefactos y reproducibilidad

Cambios locales de 4C:

- `tests/ODataGroupSemantics.test.js`: diez caracterizaciones sintéticas nuevas.
- `tests/ODataCompleteness.test.js`: una regresión adicional de comparación no certificada.
- Este documento.

Comandos ejecutados desde la raíz:

```powershell
node node_modules/jest/bin/jest.js --runInBand --silent --cache=false
node node_modules/jest/bin/jest.js tests/ODataGroupSemantics.test.js --runInBand --silent --cache=false
git diff --check
git status --short
```

La suite completa se ejecutó antes y después de añadir pruebas. No se instalaron dependencias ni se modificaron archivos productivos, credenciales, configuración o datos SAP. Sin commit, push, fusión a main ni activación de capacidades. Se entrega el dictamen para revisión y aprobación de los siguientes pasos.


## 10. Etapa 4C.1 — corrección semántica autorizada (2026-11-11)

Base aprobada y verificada: `2bf70b7`. Git estaba limpio al comenzar. Esta sección actualiza el diagnóstico histórico anterior: **la divergencia local de grupos OData queda corregida**, pero la equivalencia remota y la continuación siguen sin certificarse. P03–P05 continúan bloqueadas. No se realizaron consultas SAP ni se solicitó crear un recurso nuevo.

### Corrección implementada

En `QueryEngineService.sumSumaNetaByGroupAndDate`, después de la guarda de cobertura, se consulta la procedencia mediante `numeric.hasODataOrigin`, usando los registros de identidad existentes. No se clasifica el origen por el formato de una celda ni por una variable de entorno.

Para OData:

- La columna de grupo se identifica por el nombre canónico exacto GRUPO_ARTICULOS, no por un nombre que lo contenga.
- Se comparan strings mediante igualdad literal; no se ejecutan includes, trim ni toUpperCase para determinar coincidencias.
- Prefijos, sufijos, diferencias de mayúsculas y espacios son valores distintos.
- Null, undefined y cadena vacía no coinciden con un grupo solicitado válido. Un campo obligatorio omitido puede ser rechazado antes por el contrato estructural.
- El resultado conserva el grupo solicitado/acreditado literalmente, incluso si contiene minúsculas o espacios exteriores. El contrato DATE_GROUP sigue rechazando argumentos vacíos o compuestos solo por espacios mediante su validación previa.

Para CSV y el comportamiento legado no OData se mantiene el predicado flexible anterior, incluida su normalización de mayúsculas y espacios. No se modificaron perfiles, parser Int64 ni acumulados seguros.

### Validación del grupo en respuestas DATE_GROUP

Se agregó `ODataQueryScope.assertGroupRows`, limitada al contrato DATE_GROUP. Recorre todas las filas y exige que GRUPO_ARTICULOS sea un string exactamente igual al literal acreditado.

`ODataProvider.executeFilteredQuery` la invoca para COMPLETE_FILTERED antes de registrar el alcance privado y entregar el array al consumidor. Una fila ajena invalida el resultado entero; no se elimina para devolver una suma parcial. La captura candidata no se entrega ni se publica en MOVMAT_DATA.

`ODataCoverageService.requireComplete` repite esa validación antes de utilizar un snapshot DATE_GROUP registrado, después de la validación estructural. Esto detecta la mutación posterior del grupo de una fila, aunque la identidad de la fila permanezca igual. Son recorridos lineales por validación, no escaneos por cada lectura de métrica.

Si una proyección DATE_GROUP omite el grupo en las filas, no puede verificarse su correspondencia: se rechaza conservadoramente. No se amplía automáticamente select ni se supone que la respuesta respetó el filtro. Las consultas de count, DATE, RANGE y otras operaciones conservan sus contratos anteriores; esta comprobación no se aplica a sus filas.

Error nuevo dentro del contrato existente: **ODATA_COMPLETENESS_ERROR / SCOPE_PAYLOAD_MISMATCH, HTTP 502**. Indica una respuesta incompatible con el alcance, no una solicitud inválida del usuario ni falta de capacidad temporal. Reutiliza PaginationError y el middleware saneado; no incluye grupos, filas, filtros, URLs ni cuerpos remotos. Los errores estructurales anteriores siguen teniendo prioridad cuando falta una propiedad requerida por la proyección. Se mantienen las protecciones de caché y la prohibición de fallback EXPORT ante estos errores.

### Regresiones y resultados reales

Las diez caracterizaciones de ODataGroupSemantics se convirtieron en regresiones de la semántica autorizada. Ya no esperan el comportamiento incorrecto anterior. Se añadieron quince casos, sin eliminar las pruebas existentes.

| Momento | Resultado ejecutado |
| --- | --- |
| Baseline anterior a cualquier edición | **408/408**, 16 suites, 21,989 s. |
| Regresiones antes del cambio productivo | **18 fallidas, 6 aprobadas**, 24 casos semánticos. Fallaron coincidencias parciales, presentación del literal y aceptación de grupos ajenos. |
| Primera corrección semántica | **24/24** casos semánticos aprobados. |
| Suite completa inicial tras corregir | **422/422**, 16 suites, 22,786 s. |
| Suite completa final, con proyección sin grupo | **423/423**, 16 suites, 22,046 s. |

La matriz de nueve casos individuales ahora exige igualdad entre colección completa y subconjunto DATE_GROUP: solo el grupo idéntico suma 10; prefijo, sufijo, otra capitalización, otros espacios, grupo inexistente, nombre contenido, vacío y null suman cero cuando se consulta sobre la colección completa y el servidor sintético entrega el subconjunto literal correcto.

El caso combinado de grupos solapados ahora suma **10 en una fila en ambos caminos**, frente a los 100 en cuatro filas reproducidos antes. Los valores son exclusivamente sintéticos.

Cobertura adicional:

- Preservación de literales solicitados con minúsculas y espacios, tanto en colección como en subconjunto.
- Respuestas remotas sintéticas con grupo diferente, prefijo/sufijo, otra capitalización, espacios, vacío o null: rechazo 502, sin entregar filas parciales.
- Grupo undefined: rechazo estructural con proyección completa; rechazo de alcance si una proyección parcial permite su ausencia estructural.
- Mutación del grupo después del registro: rechazo antes de sumar y error HTTP sin el valor privado del fixture.
- CSV: se conservan coincidencias flexibles y grupo presentado normalizado, además de las suites aprobadas existentes.
- Int64 fuera del rango seguro y texto inválido siguen produciendo DATA_QUALITY_ERROR al sumar un grupo coincidente.
- Las suites completas mantienen aprobadas las comprobaciones de cobertura, caché, índices, perfiles, TTL y HTTP existentes.

Comandos ejecutados:

```powershell
node node_modules/jest/bin/jest.js --runInBand --silent --cache=false
node node_modules/jest/bin/jest.js tests/ODataGroupSemantics.test.js --runInBand --silent --cache=false
git diff --check
```

### Archivos modificados y alcance

| Archivo | Cambio |
| --- | --- |
| `src/services/QueryEngineService.js` | Igualdad literal y preservación del grupo únicamente para OData; selección canónica de la columna. |
| `src/services/ODataQueryScope.js` | Validación de filas del contrato DATE_GROUP. |
| `src/providers/ODataProvider.js` | Rechazo del resultado incompatible antes de acreditar su alcance y devolverlo. |
| `src/services/ODataCoverageService.js` | Revalidación del grupo acreditado antes de consumir el snapshot. |
| `tests/ODataGroupSemantics.test.js` | Diez caracterizaciones convertidas y quince regresiones adicionales. |
| Este documento | Corrección, evidencia y límites de la equivalencia remota. |

No se modificaron CSDL, metadata, transporte JSON, paginación, capacidades, dependencias, configuración privada ni otros métodos analíticos. No se requirió ampliar contratos de otras operaciones. Sin commit ni push.

### Límites y dictamen actualizado

La semántica **local** de esta operación OData es ahora igualdad literal, consistente entre las colecciones completas y los subconjuntos sintéticos que respetan ese contrato. Esto **no demuestra** que SAP use la misma collation que JavaScript.

Si una futura respuesta remota incluye variantes distintas del literal acreditado, se rechaza; no se oculta la diferencia filtrando localmente esas filas. Esta defensa detecta inclusiones observables, pero no acredita ausencia de omisiones del servidor ni resuelve la falta de evidencia de continuación.

Se mantiene `continuationSupported=false`, consistencia temporal UNVERIFIED y exact=false para OData. P03–P05 no se ejecutaron y siguen bloqueadas por la ausencia de un subconjunto no vacío de coste y cardinalidad verificados. El dictamen operativo anterior de no activar ni cerrar aún la certificación global del Issue permanece vigente. La corrección local queda preparada para revisión.
