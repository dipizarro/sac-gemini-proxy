# Issue 001 — Cierre técnico del desarrollo

**DESARROLLO VALIDADO LOCALMENTE / CERTIFICACIÓN OPERATIVA PENDIENTE**

Fecha: 2026-11-11. Proyecto: sac-gemini-proxy. Rama: `issue-motor-analitico-confiable`. Último commit aprobado e inspeccionado: **516c020**. Documento para revisión; no constituye autorización de activación, despliegue, fusión ni cierre automático del Issue.

## 1. Resumen ejecutivo

Se consolida el cierre técnico autorizado de las etapas implementadas del Issue 001. El desarrollo dispone de carga asíncrona coherente, protección de snapshots y derivados, interpretación numérica explícita CSV/OData, validación estructural, lector CSDL seguro, paginador acotado y controles analíticos de cobertura y alcance.

La ejecución final aprobó **423/423 pruebas, 16 suites**, con salida 0. La inspección mantiene el bloqueo de modalidades completas del activo real cuando `continuationSupported=false`. Los fallos de completitud reconocidos se propagan sin publicar el candidato parcial, renovar el snapshot anterior, activar EXPORT o devolver totales exitosos aparentemente exactos.

**Este cierre no acredita todas las garantías operativas ni ausencia de defectos pendientes.** P03–P05 no se ejecutaron; la continuación y la collation remotas no están certificadas; la consistencia temporal sigue UNVERIFIED. Además, queda pendiente comprobar la pertenencia de las fechas de cada fila al contrato DATE, DATE_GROUP o RANGE. La comprobación literal del grupo DATE_GROUP no cubre esa dimensión temporal.

La continuación debe permanecer desactivada. El cierre técnico reconoce el código y las pruebas locales aprobados, con estas limitaciones expresas; no declara al motor de colecciones completas OData listo para operación certificada.

## 2. Arquitectura final implementada

Se conservan Node.js, CommonJS, Express 5 y la separación existente entre providers, servicios, controllers y endpoints.

| Capa | Responsabilidad final |
| --- | --- |
| Providers y DataService | Carga asíncrona por origen; validación del candidato antes de publicar MOVMAT_DATA; coordinación de recargas e invalidación de derivados. |
| CacheService, QueryService, DatasetProfileService | Coherencia entre dataset, MOVMAT_INDEX_V1 y MOVMAT_PROFILE_V1; vigencia por TTL sin extensión automática ante fallo. |
| numeric.js y perfiles | Origen/contexto por identidad; CSV con perfil explícito de enteros y coma de miles; OData SUMA_NETA con perfil Int64 canónico, rango seguro y controles de acumulados/diferencias. EXPORT sin contrato numérico no habilita sumas. |
| CsvSchemaService / contrato CSV | Validación previa a convertir registros en objetos; columnas requeridas, cardinalidad de campos, duplicados/colisiones, layouts y conservación de columnas adicionales. SUMA_NETA canónica; COL_8 sin autorización implícita de métrica. |
| CsdlReader / ODataMetadataService / ODataSchemaService | Lector XML aislado y acotado, resolución explícita CSDL, adquisición segura de metadata, TTL y single-flight, tipos/proyecciones y contexto estructural. Dependencia aprobada: `@xmldom/xmldom` 0.9.12. |
| ODataTransport | JSON IEEE754Compatible, representación textual Int64, validación de count y errores saneados. |
| ODataPaginationService | COMPLETE_COLLECTION, COMPLETE_FILTERED, SERVER_COUNT y TOP_N; nextLink opaco, destinos restringidos, presupuestos, errores sin filas parciales y evidencia de cobertura. |
| ODataCapabilities / ODataCoverageService / ODataQueryScope | Activación cerrada, registro por identidad, exigencia de colección o contrato explícito DATE/DATE_GROUP/RANGE. No equivalencia heurística de filtros ni transferencia automática de cobertura a copias. |
| QueryEngine / InsightEngine / Summary / Chat | Guardas antes de calcular; ayuda general sin descarga OData; conteos reportados separados; exact=false y UNVERIFIED para OData. Igualdad literal de grupos en la operación corregida, conservando CSV flexible. |

La validez estructural, la calidad numérica, la cobertura del recorrido, la pertenencia de filas al filtro y la consistencia temporal son garantías distintas. Ninguna sustituye automáticamente a las demás.

## 3. Historial consolidado de etapas y evidencia

Los commits se verificaron mediante el historial Git. Los recuentos históricos proceden de los documentos de cada etapa; **no se reejecutó cada commit antiguo**. La verificación actual corresponde a 516c020 y a la suite final completa.

| Etapa | Commits verificados | Decisión / resultado principal | Pruebas documentadas |
| --- | --- | --- | --- |
| Diagnóstico y Etapa 1 | `5f30053`, `fb206f0` | Retirar llamadas obsoletas, operaciones asíncronas y publicación coherente de snapshots. Documento 003. | 39 → 68 |
| Contrato numérico / 2A | `5e31364`, `d742dfc` | Perfil CSV explícito; distinguir ausentes/invalidaciones de ceros reales. Documentos 004–005. | 139 |
| Descubrimiento e implementación 2B | `4d6b828`, `a7b0cd4` | Int64 OData seguro, negociación IEEE754, count validado y EXPORT sin contrato numérico. Documentos 006–007. | 170 |
| Diseño estructural / 3A | `d222a4b`, `df9ca64` | Validación estructural CSV antes de objetos/caché. Documentos 008–009. | 183 |
| Revisiones 3A | `5c170eb`, `c8ca7f7` | Rechazar alias COL_8 no acreditado; retirar su perfil CSV; mejorar comprobaciones de identidad. Documento 009, correcciones. | 187 → 189 |
| Decisión de lector / 3B.1 | `25c7ae9`, `f6d715b` | CSDL XML con namespaces, límites y aislamiento; versión exacta de xmldom aprobada. Documentos 010–011. | 236 |
| Integración 3B.2 | `743b37f` | Contrato estructural OData, metadata, payload y protección de snapshots. Documento 012. | 278 |
| Revisión 3B.2 | `7c19ad0` | Proteger filas OData reutilizadas en arrays sin contexto frente al parser legado. Documento 012. | 286 |
| Diagnóstico 4A | `f49874c` | Reproducir parcialidad de página corta y exactitud no fundamentada; evidencia real histórica acotada. Documento 013. | 286 |
| Paginador 4B.1 | `e816277` | Recorrido por nextLink, modos explícitos y presupuestos; todavía aislado de producción. Documento 014. | 345 |
| Integración 4B.2 | `2b26a5d` | Guardas en consumidores, caché, chat y preview; continuación productiva desactivada. Documento 015. | 384 |
| Revisión 4B.2 | `1c5250f` | Correspondencia de descriptores de alcance, caché global y ayuda sin consulta de datos. Documento 015. | 397 |
| Investigación 4C | `2bf70b7` | P03–P05 bloqueadas; divergencia de grupos caracterizada. Documento 016. | 408 |
| Corrección 4C.1 | `516c020` | Igualdad literal OData y rechazo de grupos ajenos a DATE_GROUP; CSV conservado. Documento 016, sección 10. | 423 |

Las decisiones históricas sustituidas deben leerse junto con sus correcciones: COL_8 no es alias autorizado; COMPLETE no equivale a exactitud temporal; las caracterizaciones de coincidencia parcial OData fueron convertidas en regresiones de igualdad literal. El comportamiento CSV flexible no se cambió por esa corrección.

## 4. Verificación final y funcionalidades comprobadas

### Ejecución de cierre

```powershell
node node_modules/jest/bin/jest.js --runInBand --silent --cache=false
git diff --check
git status --short --branch
```

Resultado real de Jest: **16 suites aprobadas, 423 pruebas aprobadas, 0 snapshots, 27,633 s, código de salida 0**. `git diff --check` no informó errores. El estado inicial estaba limpio. En este cierre solo se crea este documento; no se modifican pruebas, código, configuración ni dependencias.

La suite incluye tests unitarios, XML/JSON sintéticos, workers del lector y HTTP local de Express. Los permisos de ejecución ampliados correspondieron a las pruebas locales; no se efectuaron solicitudes reales adicionales a SAP. No se presenta esta ejecución como smoke test de un despliegue o certificación del tenant.

### Resultados locales confirmados

- Ciclo asíncrono de carga, concurrencia, recarga fallida y coherencia dataset/índice/perfil.
- Parsing numérico estricto CSV/OData, límites seguros, transporte Int64 y errores ante métricas inválidas.
- Validación CSV y CSDL, metadatos/proyecciones, errores saneados y rechazo de cambios estructurales observables.
- Recorridos sintéticos multipágina, controles de origen/ruta/redirect/ciclos, límites de páginas/filas/bytes/tiempo y fallo intermedio sin devolución parcial.
- Correspondencia entre el descriptor solicitado y el descriptor privado acreditado; rechazo de otro alcance y de copias no registradas.
- Igualdad literal local para GRUPO_ARTICULOS en OData; rechazo del grupo ajeno al DATE_GROUP acreditado, también después de una mutación detectable; semántica CSV conservada.
- Ayuda general, SERVER_COUNT reportado con exact=false, TOP_N no reutilizable como colección global y errores 503 para operaciones completas no certificadas.

Estos resultados describen los casos ejercitados y las guardas existentes. **No incluyen una validación completa de pertenencia de fechas del payload**, detallada a continuación.

## 5. Inspección de pertenencia: brecha temporal pendiente

La inspección de `ODataQueryScope.normalize/filter/matches`, `assertGroupRows`, `ODataSchemaService.validate`, `ODataCoverageService.requireComplete` y los consumidores muestra tres niveles diferentes:

1. El descriptor valida fechas ISO reales y orden de extremos, y genera un filtro explícito.
2. La guarda compara el descriptor requerido por la operación con el registrado para el array; el esquema verifica tipo/formato de FECHA cuando corresponde a la proyección.
3. **Falta comprobar que el valor FECHA de cada fila recibida satisfaga el predicado temporal de ese descriptor.** Una fecha válida estructuralmente puede estar fuera de la fecha o rango solicitado.

| Contrato | Comprobado actualmente | Pertenencia del payload pendiente |
| --- | --- | --- |
| DATE | Fecha válida en el descriptor; generación de igualdad; identidad y correspondencia del alcance. | Exigir que todas las filas pertenezcan a la fecha acreditada y rechazar fechas ajenas. |
| DATE_GROUP | Lo anterior, más igualdad literal de GRUPO_ARTICULOS en todas las filas antes de entregar y al consumir. | Exigir también la fecha acreditada. **Grupo correcto no implica fecha correcta.** |
| RANGE | Extremos válidos, from ≤ to, filtro inclusivo y correspondencia exacta de los extremos del descriptor. | Exigir from ≤ FECHA ≤ to para cada fila, con política explícita si la proyección omite FECHA. |

`assertGroupRows` solo examina GRUPO_ARTICULOS. `ODataSchemaService` reconoce Edm.Date, pero no compara sus valores con el filtro. Los cálculos locales filtran por fecha/rango; descartar filas fuera de periodo durante el cálculo **no es equivalente a rechazar una respuesta remota incompatible**, ni demuestra que no falten filas del periodo correcto.

Riesgo por inspección: una respuesta completa según su cadena, registrada con el descriptor correcto, podría contener filas de otra fecha; el consumidor podría descartarlas y producir un cero o total insuficiente sin denunciar esa incompatibilidad. En DATE_GROUP, la igualdad correcta del grupo no evita ese caso. El descriptor protege frente a reutilizar una consulta de fecha A para pedir B, pero no demuestra que el servidor haya devuelto únicamente filas de A.

Esta brecha se registra por inspección en este cierre; **no se añadieron ni ejecutaron nuevas regresiones específicas de payload con fecha ajena**. Las pruebas previas de descriptor distinto y snapshot vacío no se presentan como prueba de ese control faltante. Las modalidades completas del activo real siguen bloqueadas, lo que limita su exposición actual; no elimina la necesidad de resolverla antes de habilitarlas.

Trabajo pendiente, sujeto a una autorización posterior: validar pertenencia temporal antes de acreditar/entregar el subconjunto y al consumirlo si conserva mutabilidad; definir el tratamiento de proyecciones sin FECHA; añadir regresiones de fecha ajena, grupo correcto/fecha incorrecta, límites inclusivos de rango, fechas fuera de rango y mutaciones. Esto tampoco probará por sí solo ausencia de omisiones del servidor.

## 6. Protección ante errores y alcance de la confirmación

La inspección y la suite final confirman el comportamiento de los **errores reconocidos**:

- `ODataProvider.traverse` rechaza COMPLETE_COLLECTION y COMPLETE_FILTERED con CONTINUATION_UNCERTIFIED cuando la capacidad es false, antes de consultar datos.
- El paginador falla sin entregar filas parciales ante límites, enlaces incompatibles, fallo de página y discrepancias observadas.
- `DataService._loadRows` valida al provider antes del bloque de publicación de `_loadAndPublish`; solo después se invalidan derivados y se reemplaza MOVMAT_DATA.
- PaginationError se propaga sin EXPORT; los errores inesperados de una carga OData también se sanean sin usar ese fallback. No se oculta la recarga fallida devolviendo éxito con el snapshot previo.
- Las pruebas conservan las entradas completas de dataset, índice y perfil, incluido su vencimiento. Preservar el snapshot no extiende su TTL.
- Chat exige cobertura antes de agregar o enviar contexto numérico. El middleware no expone scope privado ni cuerpos remotos. OData usa exact=false y UNVERIFIED, incluso para recorridos sintéticos completos; count se identifica como SERVER_REPORTED.

Esto **no significa que toda incompatibilidad posible genere hoy un error**. La pertenencia de fechas pendiente puede no detectarse; por ello no se declara blindaje semántico total, aunque los errores de completitud efectivamente emitidos no publiquen parciales ni activen fallback.

## 7. Activación y limitaciones operativas

| Aspecto | Estado de cierre |
| --- | --- |
| continuationSupported | **false**, sin cambio. No hay activación por este documento. |
| Colecciones/subconjuntos completos productivos | Bloqueados sin certificación; HTTP 503 saneado. |
| SERVER_COUNT | Capacidad conservada; cada respuesta se valida y se presenta como reportada. Evidencia remota histórica limitada, no una certificación actual de todos los filtros. |
| TOP_N | Puede entregar una muestra LIMITED satisfecha bajo sus reglas; no habilita totales globales. |
| P03–P05 | **No ejecutadas**: no hay subconjunto no vacío de cardinalidad y coste previamente verificados. |
| Cadena real nextLink / recorrido multipágina | No certificados para el activo. Los fixtures no sustituyen esa evidencia. |
| Collation remota | No verificada. La igualdad literal local y el rechazo de variantes observables no acreditan equivalencia universal con SAP. |
| Consistencia temporal | **UNVERIFIED**; no hay evidencia independiente de fotografía transaccional. |
| Pertenencia temporal de filas | Pendiente en DATE, DATE_GROUP y RANGE. |
| EXPORT numérico | Sin contrato aprobado; no habilita métricas automáticamente. |

Otros límites que se conservan: los counts coincidentes no prueban identidad ni estabilidad; el hash de CSDL no detecta cambios de datos; metadata se revalida según su TTL; OAuth/metadata tienen los límites de cancelación documentados en 014–016; las filas no son profundamente inmutables; el origen de clones arbitrarios no se infiere; no hay aritmética decimal general ni offset automático. No se promueve el registro de un contrato a evidencia de consistencia remota.

La evidencia histórica de consultas vacías en 013/014 debe mantenerse diferenciada de P03–P05. No observar nextLink en un resultado vacío no demuestra que el servicio carezca de continuación.

## 8. Requisitos para certificación real posterior

1. Resolver y probar la pertenencia de FECHA en los tres contratos, conservando errores saneados y rechazo del candidato incompatible.
2. Disponer de un subconjunto no vacío seguro y coste conocido, o de un conjunto controlado ya disponible. No se exige crear un recurso SAP nuevo ni se permite sustituir esa evidencia con suposiciones.
3. Autorizar/reanudar P03–P05 bajo los límites documentados: 45 s globales, 10 s por solicitud, 64 KiB por respuesta, 128 KiB acumulados y máximo dos páginas de datos. Si no se observa agotamiento dentro del alcance seguro, conservar el dictamen no certificado.
4. Verificar count comparable, transporte, estructura, enlaces opacos, claves observables, repeticiones y terminación del recorrido real. No deduplicar heurísticamente ni ampliar presupuestos automáticamente.
5. Comprobar igualdad remota de grupos con casos controlados de mayúsculas, espacios y nombres solapados; rechazar incompatibilidades sin ocultarlas como sumas exactas.
6. Mantener UNVERIFIED/exact=false salvo evidencia temporal independiente y una decisión explícita sobre las garantías aceptadas.
7. Revisar la evidencia y aprobar cualquier activación por separado. Si se evalúa offset como alternativa, requiere diseño y autorización propios; no es un fallback autorizado por el cierre técnico.

## 9. Recomendación de fusión y despliegue

El desarrollo puede presentarse para **revisión de fusión técnica**, con sus 423 pruebas aprobadas y limitaciones aceptadas explícitamente. Una eventual fusión no debe habilitar capacidades ni comunicar certificación operativa. Este cierre no ejecuta ni autoriza automáticamente un merge a main; deben aplicarse la política del repositorio y la aprobación de sus responsables.

No recomendar un despliegue que dependa de sumas, rankings o cargas completas OData como funcionalidad operativa disponible: actualmente responderán 503 y quedan requisitos de pertenencia y certificación. Un despliegue del código defensivo con la continuación desactivada exige aceptar ese impacto funcional, revisar los consumidores del preview y realizar las verificaciones del entorno de destino. Las pruebas locales no reemplazan esa revisión.

No cerrar automáticamente el Issue de GitHub. Si el seguimiento del desarrollo se cierra administrativamente, mantener visibles y trazables la certificación operativa y la pertenencia temporal pendientes, con responsables y criterios de aceptación; no registrarlas como garantías ya completadas.

## 10. Dictamen final y límites de esta entrega

Se acepta el **cierre técnico del desarrollo implementado y validado localmente**, conforme a la aprobación del usuario y al baseline ejecutado sobre 516c020. Se conserva expresamente una brecha de validación temporal y las limitaciones remotas descritas; no se declara una certificación semántica u operativa completa.

**DESARROLLO VALIDADO LOCALMENTE / CERTIFICACIÓN OPERATIVA PENDIENTE**

Único archivo creado en esta entrega: `017-cierre-tecnico.md`. Sin cambios productivos, tests nuevos, dependencias, consultas SAP, activación de capacidades, commit, push, merge ni cierre de GitHub. Documento entregado para revisión.
