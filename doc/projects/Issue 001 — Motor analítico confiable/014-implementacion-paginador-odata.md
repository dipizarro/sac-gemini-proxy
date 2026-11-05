# Issue 001 — Etapa 4B.1: motor seguro de paginación OData

Fecha: 2026-11-05. Implementación local sobre la base aprobada de 4A. Sin commit ni push. **No se integra a las rutas productivas ni se avanza a 4B.2.**

## 1. Resultado y alcance

Se añadió un servicio especializado que recorre continuaciones OData, acota los recursos consumidos y entrega evidencia explícita de cobertura. Una operación fallida no devuelve filas parciales. El éxito estructural no acredita por sí solo completitud, calidad numérica ni consistencia transaccional.

Archivos añadidos:

| Archivo | Responsabilidad |
| --- | --- |
| `src/services/ODataPaginationService.js` | Modalidades, URL autorizada, continuación opaca, presupuestos, validación por página, resultado y errores saneados. |
| `tests/ODataPagination.test.js` | 59 pruebas con XML y JSON sintéticos, sin SAP. |
| Este documento | Decisiones, evidencia, resultados y límites de la implementación. |

No se modificaron ODataProvider, ChatController, DataService, transporte, lector CSDL, perfiles numéricos, metadata/TTL, caché, CSV, EXPORT, dependencias ni pruebas anteriores. Los defectos productivos descritos en 013 siguen pendientes de la integración 4B.2; este componente aislado no los corrige todavía.

## 2. API y arquitectura

CommonJS: `require('./ODataPaginationService').traverse(options)`. Opciones:

- `mode`: COMPLETE_COLLECTION, COMPLETE_FILTERED, SERVER_COUNT o TOP_N.
- `filter`, `select` y `orderby`: opciones internas de consulta, validadas estructuralmente por ODataSchemaService. COMPLETE_FILTERED exige filtro; COMPLETE_COLLECTION no lo acepta.
- `top`: entero positivo, obligatorio solo para TOP_N, menor o igual al presupuesto de filas.
- `continuationSupported`: false por defecto. Solo un llamador interno que disponga de un contrato de continuación respaldado puede establecer true. **No es una detección automática ni una certificación del tenant. No debe exponerse como parámetro HTTP controlado por el usuario.**
- `forceMetadata`: permite usar la revalidación explícita ya aprobada al preparar el contrato.
- `limits`: únicamente permite reducir los máximos iniciales; valores desconocidos, negativos, fraccionarios o superiores se rechazan.

El destino inicial procede exclusivamente de la configuración del activo y se valida mediante `ODataMetadataService.endpoint`. No se admite una URL arbitraria como opción. Se prepara un solo ticket estructural con `ODataSchemaService.prepare`, se valida cada página con ese ticket y se llama a `finish` antes del éxito. Esta comprobación final utiliza `ensureCurrent` y la política de TTL existente; no fuerza un GET adicional si la metadata sigue vigente.

El resultado es `{ rows, coverage }`; SERVER_COUNT añade `count`. Las filas conservan nombres originales y el contexto estructural y numérico ODATA registrado por `finish`. La API existente de `copyContext` sigue siendo la transferencia explícita del contexto estructural/numérico. **No transfiere cobertura de este resultado**: esta etapa no define todavía cómo heredar cobertura después de filtrar o transformar filas.

`coverage` contiene:

- `status`, `mode`, `scope` (filtro, proyección, orden y límite deliberado).
- `pages`: páginas de datos validadas; `rows`: filas recibidas y validadas, incluidas las que excedan el límite deliberado de TOP_N en su última página; `returnedRows`: filas finalmente entregadas.
- `bytes`: bytes descomprimidos consumidos de cuerpos de datos, sin contar OAuth/metadata. En un rechazo por tamaño declarado no se consume el cuerpo; si un chunk cruza el límite, el contador incluye ese chunk, que no se incorpora al buffer JSON.
- `termination`: SERVER_EXHAUSTED, TOP_N_REACHED, SERVER_COUNT o razón de error.
- `continuation`: respaldo declarado, número de continuaciones solicitadas y presencia de una página terminal sin enlace.
- `count`: disponibilidad, valor seguro reportado y, cuando se agota una enumeración, coincidencia con las filas descargadas.
- `structural: VALIDATED`, `numericQuality: NOT_EVALUATED`, `temporalConsistency: UNVERIFIED` en resultados exitosos.

El objeto de evidencia y sus partes se congelan; las filas mantienen la mutabilidad existente del proyecto. La evidencia describe la captura original, no autoriza reutilizarla después de mutar los datos. Scope puede contener literales privados: es interno, no se adjunta a errores y no debe registrarse ni serializarse públicamente sin una política específica.

## 3. Terminación y conteos

| Modalidad | Éxito | Rechazo relevante |
| --- | --- | --- |
| COMPLETE_COLLECTION | COMPLETE tras agotar una cadena con semántica respaldada, sin top/skip. | Falta de respaldo, count divergente, límite o error de página. |
| COMPLETE_FILTERED | Mismo criterio, referido exclusivamente al filtro. | No se eleva el subconjunto a colección global. |
| SERVER_COUNT | COMPLETE del escalar reportado para el filtro, usando count=true y top=0. No representa una descarga completa. | Count ausente/incorrecto, filas inesperadas o continuación en la respuesta de count. |
| TOP_N | LIMITED cuando se alcanzan N filas, o antes si hay agotamiento respaldado. | Menos de N sin evidencia suficiente; no devuelve silenciosamente una muestra como un Top N satisfecho. |

TOP_N aplica el límite global después de cada página; valida toda la última página recibida, conserva solo las primeras N filas y no sigue más enlaces. Sus presupuestos se aplican a lo recibido, no solo a lo retenido. No equivale al top de grupos calculado tras agregar una colección completa. El orden solicitado queda en scope; sin orderby no se afirma un ranking ni estabilidad del orden.

Una página corta o vacía con nextLink se sigue. El count no habilita por sí solo la semántica de agotamiento. Count ausente es admisible en enumeraciones respaldadas; en SERVER_COUNT es error. Todos los counts pasan por `ODataTransport.count`, sin conversión insegura. Cambios de count entre páginas y counts menores que las filas descargadas se rechazan; al agotar una enumeración se exige igualdad cuando hay count. Count mayor que N es válido en TOP_N alcanzado.

No hay deduplicación por igualdad de filas, offset automático ni reintentos. Se preserva la multiplicidad de los registros.

## 4. Continuación y controles de seguridad

- Enlaces relativos resueltos respecto de la URL actual autorizada. HTTPS, origin exacto y pathname canónico del activo deben coincidir. Se rechazan credenciales incrustadas, fragmentos, espacios/backslashes, otros hosts, puertos efectivos, protocolos y rutas. Un puerto HTTPS explícito equivalente se normaliza según URL; no representa otro origin.
- La query del enlace permanece opaca: no se reconstruye skiptoken, no se añade format/filter/select/top ni se repara una negociación ausente. Accept conserva IEEE754Compatible=true y cada respuesta debe satisfacer ODataTransport.
- Fetch usa redirect=error; también se rechazan respuestas 3xx y redirected. Los destinos de continuación se validan antes de enviar Authorization. URLs ya visitadas provocan CONTINUATION_CYCLE. Variantes de query que evadan igualdad exacta quedan acotadas por los presupuestos, sin prometer detección semántica universal de ciclos.
- El cuerpo se lee mediante stream y se limita **antes de JSON.parse**. Content-Length sirve como rechazo anticipado, nunca como sustituto del conteo de bytes reales descomprimidos. Se exige UTF-8 válido. Cuerpos rechazados se cancelan; cuerpos HTTP de error no se leen ni exponen.

| Presupuesto máximo | Valor |
| --- | --- |
| Páginas de datos | 1.000 |
| Filas recibidas | 100.000 |
| Bytes por respuesta de datos | 2 MiB |
| Bytes de datos acumulados | 64 MiB |
| Duración global del recorrido, incluidas esperas de preparación/autenticación/finalización | 120 segundos |
| Petición de datos y lectura de su cuerpo | 15 segundos o el tiempo global restante, el menor |

El vencimiento rechaza la promesa y aborta las peticiones de datos mediante AbortController; el stream también se cancela. Se comprueba el tiempo después de tramos síncronos, ya que JSON.parse no es interrumpible en el hilo principal. Su entrada está acotada a 2 MiB. No se implementó aislamiento adicional de JSON.

Las APIs preexistentes de OAuth y metadata no reciben el AbortSignal del paginador. La espera del llamador está limitada globalmente, pero una operación de preparación ya iniciada puede finalizar en segundo plano bajo sus controles existentes. No inicia nuevas páginas ni publica MOVMAT_DATA después del rechazo. Esta limitación se documenta sin ampliar el alcance a cambios de OAuth/metadata.

## 5. Contratos y errores

Se reutilizan ODataTransport, ODataSchemaService, ODataMetadataService y el perfil odata-int64 sin modificaciones. El paginador valida transporte y estructura, pero **no calcula ni declara válidas las métricas**. Una cadena completa con un Int64 textual fuera del rango seguro conserva su cobertura y el cálculo posterior falla con DATA_QUALITY_ERROR, como antes. Nulls y errores numéricos tampoco se convierten en cero.

Los errores de transporte y esquema mantienen sus clases/códigos saneados. Fallos desconocidos se convierten en ODATA_TRANSPORT_ERROR / REQUEST_FAILED, sin mensaje bruto ni cause remoto. Se añade ODATA_COMPLETENESS_ERROR con razones como NEXT_LINK_REJECTED, CONTINUATION_CYCLE, COUNT_MISMATCH, INVALID_COUNT_RESPONSE, COUNT_UNAVAILABLE, INCOMPLETE_RESULT y límites específicos.

Los errores llevan estadísticas de cobertura **sin scope ni filas**. Incompatibilidades son FAILED; falta de evidencia y límites son INDETERMINATE. Se asigna statusCode interno 502 para incompatibilidades y 503 para imposibilidad de completar/verificar bajo estos presupuestos. **No se modifica ningún contrato HTTP productivo ni meta.exact**; la decisión de mapear estos errores a endpoints queda para 4B.2. No se utiliza 422 para problemas del dataset.

## 6. Pruebas ejecutadas y resultados

| Momento | Resultado real |
| --- | --- |
| Baseline, antes de añadir archivos | 286/286 pruebas, 13 suites; 13,44 s. |
| Primeras pruebas del componente, antes de implementarlo | 39/39 fallaron por módulo inexistente. Son pruebas de especificación de un servicio nuevo, no fallos atribuidos al provider productivo. |
| Primera implementación | 39/39 pasaron. |
| Ampliación de controles | 56 pasaron y 1 falló: el rechazo anticipado por Content-Length no cancelaba el cuerpo. |
| Corrección de cancelación | 57/57 pasaron. |
| Suite completa con dos casos adicionales de deadline/saneamiento | **345/345 pruebas, 14 suites; 18,06 s**. Se conservan las 286 originales y se agregan 59. |

Cobertura nueva: páginas múltiples/cortas/vacías; enlaces relativos y tokens opacos; host/puerto/protocolo/ruta/userinfo/fragmento inválidos; redirecciones; ciclos; fallo intermedio sin filas parciales; transporte incompatible y JSON inválido; esquema por página y cambio de metadata en comprobación final; count coincidente/divergente/cambiante/ausente/inseguro/cero; TOP_N global y menor que N; ausencia de respaldo; límites de filas/páginas/bytes por respuesta y acumulados; frontera exacta de límites; streams sin Content-Length; cancelación de cuerpos y peticiones bloqueadas; deadline global en metadata/finalización y menor que timeout de solicitud; saneamiento de errores; conservación de perfil Int64 y ausencia de degradación al parser legado.

Las pruebas usan XML/JSON sintéticos y mock de OAuth/fetch; el nuevo archivo no consulta SAP. La suite completa conserva además la cobertura HTTP previa. No se añadieron endpoints para probar un servicio cuya integración está fuera de alcance.

Comandos desde la raíz:

```powershell
node node_modules/jest/bin/jest.js tests/ODataPagination.test.js --runInBand --silent --cache=false
node node_modules/jest/bin/jest.js --runInBand --silent --cache=false
node --check src/services/ODataPaginationService.js
git diff --check
git status --short
```

## 7. Sonda real acotada

Se ejecutó una sonda separada de las pruebas automatizadas y del nuevo servicio. Usó el filtro contradictorio sobre FECHA ya comprobado en 4A, cuya cardinalidad lógica es cero. **No se encontró un filtro no vacío de cardinalidad pequeña verificada**: la sonda de continuación sobre registros reales queda bloqueada, sin intentar descubrirlo mediante una descarga amplia.

Se realizaron un POST OAuth de autenticación, un GET de metadata y un GET de datos. No hubo escritura de negocio ni cambios de configuración. XML, claves y token permanecieron en memoria, sin fixtures ni archivos persistidos. CsdlReader validó el CSDL; la proyección de las tres claves declaradas se resolvió por Namespace/EntityType exactos con DOM, solo para la sonda, sin modificar la salida del lector.

Controles: 45 s globales, 10 s por solicitud, 2 MiB de metadata, 64 KiB por respuesta de datos, 128 KiB de datos acumulados y máximo dos páginas. Sin top/skip; select mínimo de claves y Prefer: odata.maxpagesize=1, tratado solo como preferencia, nunca como garantía. Se habría seguido como máximo una continuación autorizada, con validación del destino. Una respuesta con registros habría invalidado el alcance contradictorio y detenido la sonda.

Resultado saneado:

| Observación | Resultado |
| --- | --- |
| HTTP de datos | 200 |
| Filas | 0 |
| Páginas de datos consultadas | 1 |
| Cuerpo de datos consumido | 192 bytes |
| OData | 4.0 |
| JSON IEEE754Compatible | Conforme |
| nextLink / count | Ausentes |
| Preference-Applied | Ausente |

Esto demuestra únicamente que esa consulta vacía sin top/skip responde sin continuación. **No certifica generación de nextLink, transporte de tokens ni agotamiento de consultas no vacías.** No se habilitó continuationSupported en configuración ni en rutas productivas. No se publican URLs, nombres privados, claves, XML, tokens ni cuerpos.

## 8. Riesgos y pendientes de 4B.2

1. Certificar continuación en un conjunto pequeño no vacío acordado o un entorno de prueba estable. La sonda vacía no habilita COMPLETE para el activo real.
2. Definir la política de exactitud: COMPLETE sigue con consistencia temporal UNVERIFIED. Cadenas completas y counts coincidentes no detectan todos los cambios compensados, repeticiones u omisiones del servidor.
3. El contrato estructural se revalida según el TTL aprobado. Un cambio remoto durante el TTL podría no observarse en el GET final; un cambio visible de payload sí se rechaza por página. No se modificó esta política ni se promete un snapshot de metadata/datos transaccional.
4. Antes de offset: probar soporte y alcance comparable de count, disponer de claves verificadas y orden total estable, identidad utilizable, política de inserciones/borrados/cambios durante el recorrido y detección de repeticiones/omisiones. Sin esos requisitos, no autorizar un fallback automático.
5. Integrar publicación atómica, rechazo de parciales, conservación de snapshot/derivados/TTL y prohibición de fallback EXPORT silencioso, después de aprobar 4B.2. Este servicio no escribe esas cachés.
6. Definir transferencia explícita de cobertura para transformaciones y protección ante mutación de resultados. El contexto estructural de una copia no acredita por sí solo el alcance de la copia.
7. Mantener separados un TOP_N de filas y un ranking de agregados. Los cálculos de chat que necesitan el conjunto completo no pueden consumir LIMITED como si fuera global.
8. Revisar integración futura de abortos de autenticación/preparación si se requiere cancelación de extremo a extremo; no se alteraron esas APIs en esta etapa.

La Etapa 4B.1 queda preparada para revisión local. La integración productiva requiere la aprobación siguiente.
