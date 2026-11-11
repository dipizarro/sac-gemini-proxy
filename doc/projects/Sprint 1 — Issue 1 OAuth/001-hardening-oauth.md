# Sprint 1 — Issue #1: auditoría y hardening de OAuthService

Fecha: 2026-11-11. Estado: IMPLEMENTACIÓN VALIDADA LOCALMENTE, LISTA PARA REVISIÓN.

## Alcance y diagnóstico inicial

Rama `issue-1-oauth-hardening`, creada desde `issue-motor-analitico-confiable` en `15ab62b`, con árbol inicialmente limpio. Se conservan CommonJS, Express y la interfaz asíncrona `getAccessToken(): Promise<string>`. No se modificaron consumidores analíticos, configuración, secretos, dependencias ni capacidades OData. No se hicieron solicitudes reales al proveedor OAuth ni a SAP.

Hallazgos confirmados por inspección y regresiones:

| Riesgo | Estado anterior | Corrección |
| --- | --- | --- |
| Alto: exposición de credenciales de acceso | El script manual imprimía tokens completos y errores brutos; ejecutarlo/importarlo podía iniciar solicitudes. | Sin tokens ni errores remotos en consola; importar no solicita nada; ejecución real requiere `--live`. |
| Alto: exposición de respuesta remota | OAuthService incorporaba el cuerpo de errores HTTP y mensajes de excepciones a su error. | No lee cuerpos HTTP fallidos; error propio con mensaje y razón controlados, sin causa remota. |
| Alto: adquisición sin límite | Sin timeout integral ni límite de cuerpo ni prohibición explícita de redirects. | HTTPS, redirects prohibidos, presupuesto de 10 s y cuerpo máximo de 64 KiB. |
| Medio: concurrencia | Varias llamadas podían solicitar simultáneamente el mismo token. | Una promesa compartida por configuración, tanto en carga inicial como renovación. |
| Medio: expiración incorrecta | TTL predeterminado sin respaldo del emisor, valores no validados, reloj civil y margen fijo problemático para vidas cortas. | Validación de duración, reloj monotónico, plazo desde inicio de solicitud y margen proporcional. |
| Medio: rotación y recuperación | Caché no vinculada a configuración; insuficiente evidencia sobre fallos y respuestas tardías. | Invalidación por cambio de configuración, aborto de adquisición anterior y rechazo de resultados obsoletos. |
| Medio: autenticación con caracteres especiales | Basic concatenaba credenciales sin codificar cada componente como formulario. | Codificación de componentes antes de Base64. |

Las 37 regresiones iniciales fallaron con el servicio anterior. No todos esos fallos implican incidentes observados en producción: reproducen defectos o fijan las nuevas garantías locales mediante respuestas sintéticas. No se afirma una filtración ocurrida ni explotación real.

La inspección acotada de archivos versionados no identificó una credencial activa confirmada. Los marcadores de claves encontrados en documentación de dotenv eran ejemplos incompletos. No constituye una auditoría exhaustiva del historial ni de todos los secretos.

## Decisiones e implementación

### Autenticación y transporte

Se conserva `client_credentials`, POST con formulario y Basic. Cada componente de Basic se codifica como formulario antes de unirlo y aplicar Base64, conforme a [RFC 6749, sección 2.3.1](https://www.rfc-editor.org/rfc/rfc6749.html#section-2.3.1). El endpoint debe ser HTTPS, sin userinfo, fragmento, espacios o barras invertidas. No se imprimen URL, cabeceras ni respuestas.

Se exige HTTP 200 y JSON UTF-8; se rechazan contenido incompatible, JSON malformado y bytes UTF-8 inválidos. El token debe tener representación Bearer válida para cabecera, con `token_type` Bearer sin distinguir mayúsculas. No se decodifican claims JWT ni se infiere su expiración. La validación de `token_type` sigue el contrato de respuesta de [RFC 6749, sección 5.1](https://www.rfc-editor.org/rfc/rfc6749.html#section-5.1).

Un AbortController y una carrera de promesas acotan adquisición y lectura a 10 segundos. Se cancela el lector; las respuestas tardías no publican tokens. Se limita el cuerpo efectivamente leído a 64 KiB y se rechaza anticipadamente un Content-Length excesivo. Los redirects no se siguen. La comprobación monotónica posterior evita aceptar una respuesta si el temporizador se demoró.

### Caché y ciclo de vida

- Estado privado en memoria por proceso, vinculado a endpoint, cliente y secreto. No se persisten tokens.
- `expires_in` presente debe ser un entero positivo seguro, como número o string de dígitos, también seguro al convertirlo a milisegundos.
- Si falta `expires_in`, se devuelve el token a los participantes de esa adquisición, sin caché reutilizable. No se inventa una duración que el emisor no declaró.
- Vigencia de reutilización desde inicio de solicitud: mínimo entre duración declarada y 24 horas, menos un margen del 10 % limitado a 60 segundos. Nunca extiende la vida declarada.
- Reloj monotónico; atrasar el reloj civil no prolonga la caché. Una respuesta ya vencida respecto al margen se rechaza.
- Concurrencia comparte una única adquisición. Un fallo limpia el estado pendiente; la próxima llamada puede recuperarse. No hay reintento automático ni entrega de token vencido ante fallo.
- Un cambio de configuración invalida la caché y aborta la adquisición anterior al observarse en una llamada. También se compara la configuración antes de aceptar una respuesta. No se implementa vigilancia activa de archivos o secretos.

### Errores y compatibilidad

`OAuthError` conserva un mensaje fijo, código `OAUTH_ERROR` y `details.reason` controlado. Configuración inválida lleva `statusCode=500`; timeout, 503; otros fallos de adquisición, 502. Son metadatos de error del servicio: los consumidores conservan sus contratos HTTP existentes y pueden envolverlos. No se afirma que todos los endpoints expongan esos códigos directamente.

Razones: `INVALID_CONFIG`, `CONFIG_CHANGED`, `TIMEOUT`, `REQUEST_FAILED`, `HTTP_ERROR`, `REDIRECT_REJECTED`, `CONTENT_TYPE`, `RESPONSE_LIMIT`, `INVALID_JSON`, `INVALID_TOKEN`, `INVALID_EXPIRY` y `TOKEN_EXPIRED`. Fetch puede expresar un redirect rechazado como error de red; en ese caso se recibe `REQUEST_FAILED`, igualmente saneado. No se conserva `cause` ni mensaje remoto.

Cambios intencionales: se rechazan respuestas previamente aceptadas sin tipo Bearer, tokens malformados, duraciones inválidas y endpoints inseguros; ausencia de duración deja de implicar una hora de caché. El script manual ahora es inerte sin `--live`, y comparar resultados no se presenta como prueba concluyente de caché.

## Archivos modificados

| Archivo | Justificación |
| --- | --- |
| `src/services/OAuthService.js` | Autenticación, validación, límites, caché, concurrencia y errores saneados. |
| `src/test-oauth-manual.js` | Eliminar exposición y solicitudes implícitas; preservar comprobación manual explícita. |
| `tests/OAuthService.test.js` | 47 pruebas nuevas de ciclo de vida, seguridad e integración con consumidores reales usando transporte simulado. |
| Este informe | Único informe técnico del issue. |

## Verificación ejecutada

| Ejecución | Resultado real |
| --- | --- |
| Baseline completo antes de modificaciones | 423/423, 16 suites; 30,260 s; salida 0. |
| 37 regresiones iniciales sobre implementación anterior | 37 fallidas; 11,591 s. Incluye timeouts de Jest ante promesas sin límite. |
| Primer pase del servicio corregido | 37/37; 1,602 s. |
| Pase ampliado tras revisión de carreras y consumidores | 47/47; 1,263 s. |
| Suite completa final | **470/470, 17 suites; 25,981 s; salida 0.** |
| `git diff --check` | Sin errores. |
| Script manual sin argumentos | Salida 0, informa que no realiza solicitudes; no importa OAuthService en esa ruta. |

Se conservaron todas las pruebas anteriores sin reescribirlas. Casos añadidos: Basic con caracteres especiales, caché, margen exacto y vidas cortas, duración ausente/inválida, treinta llamadas concurrentes, renovación compartida, rollback del reloj civil, rotación durante adquisición, respuesta obsoleta después de timeout, recuperación, fallos HTTP/red saneados, cancelación de cuerpos, límite por bytes y cabecera, JSON/UTF-8 inválidos y ausencia de filtración en script manual.

La integración usa ODataMetadataService, ODataPaginationService y creación de job de ExportService con `fetch` sustituido y fixtures sintéticos. Verifica que los tres comparten la interfaz y token almacenado. No crea jobs externos. La suite completa utiliza mocks y servidores locales; no certifica autenticación real con el tenant.

Comandos reproducibles desde la raíz:

```powershell
node node_modules/jest/bin/jest.js tests/OAuthService.test.js --runInBand --silent --cache=false
node node_modules/jest/bin/jest.js --runInBand --silent --cache=false
git diff --check
node src/test-oauth-manual.js
```

No ejecutar `--live` como parte de estas verificaciones automatizadas.

## Riesgos residuales y límites

- No se probó el emisor real por restricción expresa. Un proveedor que omita `token_type`, envíe un MIME no conforme o use una variante no estándar de Basic requerirá revisión explícita, no relajación silenciosa.
- Los temporizadores dependen del event loop; no son aislamiento contra bloqueo arbitrario del proceso. El tamaño acotado limita el trabajo de parseo. El transporte nativo de Node respeta abort; la carrera evita bloquear al consumidor incluso si una implementación simulada lo ignora.
- La caché no se comparte entre procesos. No se implementa invalidación ante revocación temprana del emisor ni reintento automático después de 401 en los consumidores.
- Un consumidor que retenga el token durante una operación larga debe gestionar ese ciclo por separado. No se cambió el polling de exportaciones ni su renovación durante el job.
- **Hallazgo fuera del alcance:** ExportService conserva errores propios de exportación que pueden incluir cuerpos remotos, y ExportController expone `error.message`. Los errores OAuth están saneados antes de llegar allí; se recomienda un issue separado para sanear los demás fallos de exportación.
- No hay borrado garantizado de strings de tokens/credenciales en memoria de JavaScript. No se persisten ni registran por este servicio; volcados de memoria requieren controles operativos independientes.

## Commits y recomendación

Implementación y 47 pruebas: `c19d904` — `Harden OAuth token lifecycle and sanitize failures`.
Este informe se registra en un commit documental posterior, identificable con `git log --oneline issue-1-oauth-hardening`. No se fusionó a main ni se cerró el issue automáticamente.

Se recomienda aprobar técnicamente y cerrar el Issue #1 tras revisar el diff: client_credentials, caché, expiración, concurrencia, recuperación y protección de errores tienen evidencia automatizada local. Esta recomendación no certifica conectividad ni compatibilidad operativa del emisor real. La revisión de errores no OAuth de exportación queda expresamente separada.
