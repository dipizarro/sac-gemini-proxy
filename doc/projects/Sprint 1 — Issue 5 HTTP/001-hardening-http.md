# Sprint 1 — Issue #5: hardening mínimo HTTP

Fecha: 2026-11-11. Estado: VALIDADO LOCALMENTE / LISTO PARA REVISIÓN TÉCNICA.

## Dictamen

Se implementaron identificación de solicitudes, rate limiting básico y CORS explícito, con saneamiento de errores en la frontera HTTP. La suite final aprueba **455/455 pruebas**, incluidas las 423 anteriores y 32 nuevas. No se consultó SAP ni Gemini, no se instalaron dependencias y no se modificaron secretos, reglas analíticas ni capacidades OData.

Se recomienda cerrar técnicamente el Issue #5 tras revisión del diff. **No se recomienda exponer el servicio públicamente todavía:** no tiene autenticación ni autorización de sus endpoints de datos, administración y exportación. Estos controles reducen riesgos, pero no otorgan permisos ni constituyen una certificación de seguridad o de capacidad operativa.

## Base e independencia

Rama `issue-5-http-hardening`, creada desde `issue-motor-analitico-confiable` en `15ab62b`, con árbol limpio. No incluye los commits de `issue-1-oauth-hardening`; por eso el baseline es 423, no 470. La interfaz de OAuth no se tocó. El saneamiento de errores de exportación corresponde aquí a la frontera HTTP, no al ciclo de tokens.

Commit de implementación y pruebas: `fcb64e3` — `Add minimal HTTP request identification, rate limits and strict CORS`. Este informe se registra en un commit documental posterior. No se fusionó a main, no se cerró el issue y no se desplegó a Azure.

## Diagnóstico confirmado

| Componente | Hallazgo | Impacto |
| --- | --- | --- |
| `server.js` | Una lista CORS vacía aceptaba cualquier origen; parser JSON antes de CORS. | Política permisiva por omisión y trabajo de parseo para orígenes no autorizados. |
| Servidor y rutas | Sin request-id ni cuotas de solicitudes. | Diagnóstico sin correlación y acceso repetido a recursos costosos. |
| `/chat`, `/ds/movmat`, `/ds/export/preview`, `/csv/*` | Datos, llamadas remotas, cálculos y recarga accesibles sin autenticación. | Exposición de datos y consumo de recursos; rate limiting no resuelve autorización. |
| `errorHandler.js` | Registraba mensaje/stack bruto; podía publicar mensaje `isOperational` y stack en desarrollo. | Errores de servicios externos podían revelar contenido sensible. |
| `ExportController.getPreview` | Registraba error bruto y devolvía `error.message` directamente. | Bypass del saneamiento central. |
| Fallback 404 | Reflejaba `req.url`, incluida query. | Datos de la URL podían reaparecer en la respuesta. |
| `/csv/status` | Contrato existente muestra una ruta local. | Información interna en respuesta exitosa; requiere protección de acceso antes de exposición pública. No se cambió este contrato analítico aprobado. |

Los hallazgos se basan en inspección del código y pruebas locales, no en incidentes de explotación observados. No se hizo pentest externo ni auditoría exhaustiva de dependencias o historial de secretos.

## Diseño e implementación

### Ensamblado mínimo

`src/app.js` expone `createApp()` sin abrir un puerto. `server.js` conserva `node server.js`/`npm start` como arranque. El router conserva su exportación compatible y añade `createRouter()` para crear cuotas independientes por aplicación. No se cambia lógica de consultas, cálculo, publicación o caché.

Orden productivo: request-id → validación CORS → cuota global → respuesta preflight → JSON → router/cuotas de negocio → 404 → manejo de errores. Los orígenes rechazados terminan con 403 antes del parser y de la cuota global; no ejecutan controladores. Los preflight autorizados sí consumen cuota global.

### Identificación

Cada solicitud que llega a Express recibe un UUID nuevo mediante `crypto.randomUUID()`, disponible en `req.requestId` y `X-Request-ID`. Se ignora el ID proporcionado por el cliente, evitando reflejar identificadores manipulados. El header aparece también en respuestas 400, 403, 404, 413, 415, 429 y 500/503 probadas. Se expone mediante CORS a orígenes autorizados.

Los errores inesperados se registran como evento, ID y status controlado, sin URL, body, mensaje remoto ni stack. No se añade un log de acceso por solicitud ni trazabilidad distribuida. Errores del protocolo HTTP rechazados por Node antes de Express no reciben este ID; deben correlacionarse en la infraestructura de entrada.

### Cuotas

| Ámbito | Cuota por IP y proceso |
| --- | --- |
| Global, incluyendo health, UI, 404 y preflight autorizados | 120 solicitudes / 60 s |
| Negocio: chat, Datasphere, CSV y rutas desconocidas que alcanzan esa sección del router | 20 solicitudes / 60 s, compartidas |
| POST `/csv/reload` | 5 solicitudes / 60 s adicionales |

Son ventanas fijas iniciadas por cliente, con reloj monotónico. Solicitudes admitidas se contabilizan aunque el controlador falle. Intentos bloqueados no prolongan la ventana. Las cuotas se aplican antes de los controladores; JSON malformado se rechaza antes de la cuota de negocio, pero ya consume la global. Casing, barra final, query o `X-Forwarded-For` no crean cuotas alternativas. En exceso se devuelve 429, `code: RATE_LIMITED`, `Retry-After` en segundos y `Cache-Control: no-store`. Un origen autorizado conserva sus headers CORS en el 429.

Cada limitador conserva como máximo 10.000 IPs. Una limpieza acotada se realiza como máximo una vez por ventana; las entradas expiradas de la IP consultada también se eliminan. Si no puede admitir una IP nueva por capacidad, devuelve 503 `RATE_LIMIT_CAPACITY` con Retry-After, sin expulsar entradas activas ni crecer sin límite. No hay timers de limpieza ni persistencia externa.

No se agregó una dependencia para este contador acotado. Estos umbrales iniciales conservadores son revisables en código: no derivan de una prueba de capacidad real de SAP/Gemini. No se ofrece un mecanismo de configuración que permita desactivarlos inadvertidamente.

`trust proxy` queda explícitamente en `false`. La IP proviene de la conexión y no de cabeceras falsificables. Un reverse proxy hará que varios usuarios compartan su cuota; antes de desplegar debe definirse la topología y validar proxies confiables concretos. No se usa `true` ni un número de saltos supuesto. Esta cautela sigue la documentación de [Express detrás de proxies](https://expressjs.com/en/guide/behind-proxies/).

### CORS y configuración

Se reutiliza `ALLOWED_ORIGINS`, lista separada por comas, ya leída por la configuración existente. No se modificó ningún archivo de entorno.

- En producción (`NODE_ENV=production`), la lista debe ser no vacía y contener orígenes HTTPS canónicos exactos; configuración inválida impide iniciar la aplicación con un mensaje fijo.
- No se permiten comodines, `null`, userinfo, rutas, query o fragmentos. El origen debe coincidir con `URL.origin`; no se aceptan variantes no canónicas como slash final o puerto HTTPS predeterminado explícito.
- En desarrollo/test se permiten orígenes HTTP o HTTPS expresamente declarados. Lista vacía deniega solicitudes con Origin, no abre todos los orígenes. Para desarrollo local, declarar por ejemplo `http://localhost:3000`; otro puerto requiere su propia entrada.
- Solicitudes sin Origin siguen admitidas y limitadas. Clientes no navegador pueden omitir o falsificar Origin: no es autenticación.
- Preflight: métodos GET, HEAD y POST; cabeceras `content-type` y `x-request-id`; cache de preflight 600 s. Métodos/cabeceras no autorizados reciben 403 saneado.
- No se habilitan credenciales CORS. Se exponen `X-Request-ID` y `Retry-After`, y se usa Vary: Origin.

La biblioteca cors configura lo que el navegador puede leer; el rechazo HTTP explícito es adicional y no sustituye controles de acceso. Véase la [documentación oficial de cors](https://expressjs.com/en/resources/middleware/cors/).

### Errores y límites de entrada

Los errores estructurados aprobados de esquema, integridad numérica, transporte y completitud conservan su código, status y detalles saneados. Los demás errores reciben mensajes fijos; no se confía en `isOperational` para publicar texto arbitrario. Si ya se enviaron cabeceras, se registra un evento seguro y se cierra la respuesta, sin delegar el error bruto al manejador por defecto.

ExportController ahora usa `next(error)`: cambia intencionalmente el sobre de errores de exportación al formato central, eliminando `details: error.message`. Las respuestas exitosas no cambian. El 404 deja de reflejar la URL.

JSON mantiene el límite de 100 KiB y pasa a rechazar cuerpos comprimidos (415), para no descomprimir entradas no confiables. JSON inválido devuelve 400 y cuerpo excesivo, 413. Se desactiva `X-Powered-By`.

El arranque configura recepción de headers a 15 s, recepción de solicitud a 30 s y keep-alive a 5 s. Son controles de recepción de Node, no cancelación de cálculos o llamadas remotas en curso; el cumplimiento temporal depende del event loop y del chequeo del servidor. Se inspeccionó esa configuración, sin ejecutar una prueba prolongada de conexiones lentas. Referencia: [Node HTTP requestTimeout](https://nodejs.org/api/http.html#serverrequesttimeout).

## Archivos

| Archivo | Motivo |
| --- | --- |
| `src/app.js` | Ensamblado comprobable de Express y orden de controles. |
| `server.js` | Arranque explícito y límites de recepción. |
| `src/middlewares/httpSecurity.js` | UUID, CORS estricto y contador acotado en memoria. |
| `src/middlewares/errorHandler.js` | Saneamiento de errores genéricos y logs, incluso después de headers. |
| `src/routes/index.js` | Cuotas de negocio y recarga, factory conservando exportación existente. |
| `src/controllers/ExportController.js` | Unificar error de exportación en el manejador central. |
| `tests/HttpHardening.test.js` | 32 pruebas nuevas unitarias y HTTP. |
| Este informe | Única entrega documental del Issue #5. |

## Evidencia de pruebas

Node local: v22.14.0. Jest en serie, sin caché. Servicios de negocio simulados y servidores HTTP de loopback; no se usó SAP ni Gemini.

| Verificación | Resultado observado |
| --- | --- |
| Baseline de la base aprobada | 423/423, 16 suites, 24,268 s. |
| Primer contrato de pruebas, antes de implementar | 23 fallidas por ausencia de los nuevos módulos/factory. Esto evidencia componentes faltantes; no se presenta como 23 vulnerabilidades reproducidas independientemente. |
| Primer pase implementado | 22 pasaron; 1 timeout por parametrización incorrecta de la lista vacía en el test. Corregido el fixture, sin relajar expectativas. |
| Primer pase completo corregido | 446/446, 17 suites, 24,901 s. |
| Ampliación de revisión: CORS en 429, preflight, concurrencia, compresión y ventanas | 30/30 específicas; suite completa 453/453, 25,572 s. |
| Revisión final: error después de headers y contrato analítico | 32/32 específicas, 1,610 s. |
| **Suite completa definitiva** | **455/455, 17 suites, 24,491 s; salida 0.** |
| `git diff --check` | Sin errores de whitespace; avisos normales LF/CRLF de Git en Windows. |

No se modificó ninguna de las 423 pruebas existentes. Se verifica UUID no controlado por cliente; CORS normal/denegado/configuración vacía/producción/preflight; ningún controlador ejecutado ante rechazo; límites compartidos y recarga; ráfaga concurrente (20 admitidas, 5 rechazadas); cabeceras reenviadas sin efecto; frontera temporal y capacidad del mapa; mensajes, logs, 404, cuerpos inválidos/excesivos/comprimidos y error de exportación saneados; preservación del error analítico 503.

Comandos desde la raíz:

```powershell
node node_modules/jest/bin/jest.js tests/HttpHardening.test.js --runInBand --silent --cache=false
node node_modules/jest/bin/jest.js --runInBand --silent --cache=false
git diff 15ab62b..HEAD --check
```

Las repeticiones de suite respondieron a cambios de código y nuevos casos de revisión, no a consultas externas. No se hizo prueba real de carga ni una auditoría de seguridad ilimitada.

## Riesgos residuales y preparación de despliegue

1. **Autenticación/autorización pendientes:** proteger datos, recarga, status y exportación. En particular, el GET de preview puede iniciar trabajo remoto; CORS no evita llamadas sin Origin. Tampoco oculta datos de negocio a clientes autorizados por red pero no por identidad.
2. **Multiinstancia:** cuotas independientes por proceso, reiniciadas al reiniciar; N instancias pueden admitir aproximadamente N veces el presupuesto. Se requiere limitación compartida en gateway o almacenamiento central antes de exigir una cuota global.
3. **IP como aproximación:** NAT/proxy comparte cuota; IPv6 rotativo o muchas IPs pueden eludir un límite por dirección. No se agrupan prefijos IPv6 ni se mitiga DDoS. Las ventanas permiten ráfagas alrededor de su frontera. Se necesita protección de infraestructura y límites por identidad al incorporar autenticación.
4. **Tiempo y concurrencia:** cuota de frecuencia no limita la duración o cantidad de operaciones simultáneas ya iniciadas. Los timeouts de recepción no cancelan trabajos analíticos/remotos. Validar capacidad y cancelación en el despliegue futuro.
5. **Configuración de plataforma:** TLS, proxy confiable, límites de conexiones, encabezados de seguridad apropiados a UI/widget y observabilidad requieren decisiones del despliegue. No se supuso una topología Azure ni se configuró HSTS/CSP a ciegas.
6. **Información interna preexistente:** `/csv/status` muestra ruta local; restringir acceso o revisar ese contrato antes de hacerlo público. El presente trabajo sanea errores, no rediseña todas las respuestas exitosas.
7. **Issue #1 independiente:** aplicar/revisar también el hardening de OAuth antes de despliegue; este branch conserva el servicio OAuth y script manual de la base. El saneamiento HTTP no corrige por sí solo todo el ciclo del token ni scripts ejecutados fuera de HTTP.

La entrega cumple el alcance mínimo verificable del Issue #5 y queda lista para revisión y fusión posterior autorizada. Su aprobación no debe interpretarse como autorización para despliegue público ni cierre automático de otros riesgos.
