# Issue 001 — Etapa 3B: decisión del lector de metadata OData

Fecha: 2026-11-04. Investigación concluida; implementación pendiente de aprobación.

## 1. Decisión recomendada

Consumir **CSDL XML**, solicitando `Accept: application/xml` en el endpoint `$metadata` ya identificado, con un lector acotado basado en **`@xmldom/xmldom` 0.9.12**, sujeto a aprobación de esa dependencia y revisión de sus avisos de seguridad al instalar. Usar DOM con namespaces y resolución explícita de referencias CSDL; no expresiones regulares para extraer propiedades ni búsqueda global por nombre.

El servicio configurado respondió XML correctamente y rechazó las tres variantes de negociación JSON probadas. No se recomienda un lector dual ni intentar JSON en cada carga. La selección de XML afecta exclusivamente metadata: el transporte JSON de datos y `IEEE754Compatible=true` permanecen intactos.

## 2. Evidencia obtenida mediante lectura

Se revisaron 006 y 008. El primero documentó OData 4.0 y SUMA_NETA Int64; el segundo dejó pendiente verificar JSON CSDL o aprobar un parser XML. Esta investigación renueva la evidencia del formato y resuelve esa alternativa, sin implementar la validación estructural.

Git estaba limpio al inicio. Se utilizó la URL configurada únicamente en memoria, comprobando la forma de ruta descrita en 006 y sustituyendo el último segmento de entidad por `$metadata`. No se consultaron otros activos ni se enumeraron endpoints. Se obtuvo un token con el flujo OAuth Client Credentials existente: **un POST de autenticación, HTTP 200**, necesario para los GET autorizados; no fue una escritura de datos ni una acción de negocio SAP.

Se ejecutaron cinco GET al mismo endpoint:

| Caso | Accept | `$format` | HTTP | Content-Type | Resultado |
| --- | --- | --- | --- | --- | --- |
| XML explícito | application/xml | ausente | 200 | application/xml | CSDL XML válido para la sonda |
| JSON mediante Accept | application/json | ausente | 406 | application/json | Negociación rechazada |
| JSON abreviado | application/json | json | 406 | application/json | Negociación rechazada |
| JSON MIME completo | application/json | application/json | 406 | application/json | Negociación rechazada |
| XML mediante formato | application/xml | xml | 200 | application/xml | CSDL XML válido para la sonda |

Ambas respuestas XML declararon `OData-Version: 4.0` y `Edmx Version="4.0"`. Se reconocieron los namespaces públicos EDMX y EDM y la jerarquía Edmx → DataServices → Schema.

La sonda resolvió por igualdad exacta el EntitySet correspondiente al último segmento configurado: una coincidencia. Resolvió su atributo EntityType mediante Namespace/Alias y nombre local: una coincidencia, sin BaseType declarado. Dentro de ese tipo encontró una propiedad canónica SUMA_NETA, de tipo Edm.Int64, sin atributos Nullable, Precision ni Scale. No se imprimieron nombres de entidad, namespace privado, contenedor ni activo.

**Conclusión observada:** XML está soportado en el endpoint y contexto de autorización actuales; JSON CSDL no está disponible mediante las tres negociaciones estándar ensayadas. Esto no demuestra una imposibilidad universal para todos los servicios o futuras versiones de Datasphere. Los 406 no son CSDL JSON: que un error tenga Content-Type application/json no lo convierte en metadata. No se publicaron ni analizaron semánticamente sus cuerpos.

CSDL JSON utiliza miembros de modelo como `$Version`, `$EntityContainer`, schemas y elementos con `$Kind`/`$Type`; el array `value` del JSON de registros no acredita ese formato. No se observó un documento CSDL JSON exitoso del tenant, por lo que no existe MIME/estructura efectiva JSON que reportar. [OASIS, CSDL JSON 4.01](https://docs.oasis-open.org/odata/odata-csdl-json/v4.01/os/odata-csdl-json-v4.01-os.html).

### Controles y límites de las sondas

- HTTPS, redirects rechazados, timeout de 15 segundos por petición, límite de cuerpo de 2 MiB. Sin consultas al dataset, ni siquiera muestras de registros; sin paginación, exportación o jobs.
- Credenciales/token/cuerpos solo en memoria. Salida limitada a HTTP, MIME, versión, booleanos y cantidades de coincidencias. Las excepciones se sustituyeron por códigos genéricos.
- Para comprobar XML sin instalar paquetes se usó temporalmente `System.Xml` de .NET con `DtdProcessing=Prohibit`, `XmlResolver=null` y límite de caracteres. No se propone invocar PowerShell/.NET desde producción Node.
- No se guardó metadata privada, no se siguieron referencias externas y no se certificaron todas las anotaciones ni tipos de dimensiones. La sonda de identidad no constituye todavía un validador CSDL completo.

## 3. Comparación de lectores XML

Se consultaron por GET los manifiestos públicos del registro npm, sin instalar ni ejecutar los paquetes. Tamaños del paquete descomprimido reportados por `dist.unpackedSize`: no son tamaño de bundle, memoria DOM ni total incluyendo transitivas.

| Alternativa | Versión observada / publicación | CommonJS y dependencias de ejecución | Tamaño | Evaluación |
| --- | --- | --- | --- | --- |
| @xmldom/xmldom | 0.9.12 / 2026-08-21 | `lib/index.js`, CommonJS; Node >=14.6; sin dependencias; MIT | 440.251 bytes | Recomendada: DOM con identidad de namespace, API conocida y grafo de dependencias pequeño. Exige endurecer errores y limitar recursos. |
| fast-xml-parser | 5.12.0 / 2026-11-03 | Entrada CommonJS `lib/fxp.cjs` aunque el paquete declara type module; seis dependencias directas; MIT | 1.335.158 bytes | Mantenimiento reciente; más superficie y adaptación de objetos/atributos/namespaces para este uso. No se selecciona. |
| saxes | 6.0.0 / 2021-11-07 | CommonJS; Node >=12.22.7; xmlchars como dependencia; ISC | 163.774 bytes | Streaming y namespaces serían útiles, pero el repositorio está archivado desde 2025-12-31. No se recomienda introducirlo como lector mantenido. |

Fuentes de los manifiestos: [registro @xmldom/xmldom](https://registry.npmjs.org/@xmldom%2Fxmldom), [registro fast-xml-parser](https://registry.npmjs.org/fast-xml-parser), [registro saxes](https://registry.npmjs.org/saxes). Archivo del proyecto: [repositorio saxes](https://github.com/lddubeau/saxes).

No confundir `@xmldom/xmldom` con el paquete antiguo sin scope `xmldom`: los mantenedores consideran deprecadas las versiones de este último por vulnerabilidades y mantienen las dos últimas versiones menores del proyecto actual. [Política de seguridad](https://github.com/xmldom/xmldom/blob/master/SECURITY.md).

Ninguna biblioteca queda certificada como libre de vulnerabilidades. La versión 0.9.12 de xmldom incorpora correcciones de consumo cuadrático por namespaces y atributos; los avisos sobre recuperación de XML malformado refuerzan la necesidad de abortar ante diagnósticos. [Changelog 0.9.12](https://raw.githubusercontent.com/xmldom/xmldom/0.9.12/CHANGELOG.md), [aviso sobre recuperación malformada](https://github.com/xmldom/xmldom/security/advisories/GHSA-93r5-fhx6-vmg9). fast-xml-parser también ha publicado correcciones por expansión de entidades; no se afirma que su versión actual siga afectada por esos avisos. [Avisos del proyecto](https://github.com/NaturalIntelligence/fast-xml-parser/security/advisories).

RegEx, un parser XML artesanal y conversión vía subprocess .NET se descartan como estrategia productiva por mantenimiento, corrección y portabilidad. JSON nativo sería sencillo, pero no satisface la evidencia actual del servicio.

## 4. Lectura y resolución sin heurísticas

La siguiente es la propuesta de implementación, no código ya incorporado:

1. **Transporte separado:** GET metadata autenticado desde la raíz de servicio validada; Accept XML, sin `$format` JSON ni negociación IEEE754 de datos. Verificar estado, MIME XML, versión y raíz con namespace correcto. Un HTTP 200 con HTML, JSON de registros o XML ajeno debe fallar. No intentar interpretar cuerpos de error como modelos.
2. **DOM seguro:** parsear como application/xml; usar `onError` para abortar también ante warnings, sin imprimir el mensaje original. No aceptar el DOM recuperado tras un diagnóstico. El parser admite ese callback; no basta con que `parseFromString` devuelva un objeto. [API de DOMParser 0.9.12](https://raw.githubusercontent.com/xmldom/xmldom/0.9.12/lib/dom-parser.js).
3. **Índices explícitos:** recorrer hijos directos por `namespaceURI` y `localName`, no por prefijo literal. Crear mapas con Map para Namespace, Alias, tipos y contenedores. Rechazar declaraciones duplicadas o aliases ambiguos. Cambiar un prefijo XML no cambia identidad; un namespace URI diferente sí.
4. **Fuente exacta:** resolver el segmento de EntitySet de la URL configurada por igualdad, dentro de los contenedores del modelo. Si existen varias coincidencias, exigir identificación explícita del contenedor; nunca elegir la primera. Resolver `EntityType` como nombre cualificado usando Namespace/Alias. No concatenar identificadores privados en expresiones XPath.
5. **Tipo y propiedades:** resolver BaseType recursivamente con detección de ciclos, referencias faltantes y límite de profundidad; reunir propiedades heredadas y propias sin sobrescrituras silenciosas. Buscar cada propiedad requerida por nombre exacto únicamente en el tipo resultante. Separar Property de NavigationProperty. Distinguir tipos escalares de `Collection(...)` y tipos definidos por el modelo; no convertir automáticamente estos últimos a Int64.
6. **Facetas:** conservar presencia original y valor efectivo. Para una propiedad escalar, Nullable omitido equivale a true. Precision y Scale solo se interpretan para los tipos donde aplican; no asignar escala cero a Int64 por ausencia de atributos. Un valor léxico de faceta inválido debe fallar, no convertirse mediante parseInt parcial. No inferir contrato de otras métricas por SUMA_NETA. [OASIS CSDL 4.0, propiedades y facetas](https://docs.oasis-open.org/odata/odata/v4.0/errata03/os/complete/part3-csdl/odata-v4.0-errata03-os-part3-csdl-complete.html).
7. **Anotaciones:** resolver términos cualificados y targets exactos, tanto inline como externos, conservando Qualifier y las expresiones/path que afecten interpretación. No buscar textos que contengan Unit/Label ni tomar etiquetas como evidencia de unidad. Resolver aliases declarados; referencias necesarias no disponibles deben producir error explícito. No descargar automáticamente documentos de `edmx:Reference`. Las referencias a vocabularios no usados no deben bloquear un tipo local resoluble. [OASIS CSDL XML, schemas, referencias y anotaciones](https://docs.oasis-open.org/odata/odata-csdl-xml/v4.01/os/odata-csdl-xml-v4.01-os.html).

La extracción produce un esquema normalizado interno; la comparación de compatibilidad y la validación de payload son pasos separados. Propiedades adicionales y cambios decorativos no implican rechazo automático. No hace falta construir un framework ni agregar un motor XPath.

## 5. Seguridad y mantenimiento de la estrategia elegida

Propuesta a aprobar junto con el lector:

- Fijar versión exacta y lockfile; revisar avisos de esa versión antes de instalar. No usar el paquete sin scope ni suponer que ausencia de dependencias elimina riesgos.
- Rechazar DOCTYPE/DTD y declaraciones de entidades. No habilitar resolución de entidades externas, XInclude ni descarga de referencias. El chequeo de declaraciones prohibidas puede ser conservador antes del parseo; no sustituye al parser ni se usa para extraer esquema. Verificar además ausencia de DocumentType en el DOM.
- Decodificación UTF-8 estricta y coherencia con declaración XML; rechazar codificaciones no soportadas explícitamente. Límite inicial propuesto: 2 MiB de cuerpo descomprimido, profundidad DOM 64, 50.000 nodos y 128 atributos por elemento. Son límites de diseño, no capacidades medidas ni contrato ya aprobado.
- El límite posterior del DOM no protege durante el parseo. Ejecutar el parseo acotado en worker de Node con presupuesto de tiempo/memoria, terminable desde el hilo principal; un setTimeout en el mismo hilo no interrumpe un parser síncrono. Probar los límites con fixtures antes de habilitarlo. No añadir una segunda biblioteca para ello.
- Rechazo saneado de XML malformado, duplicados, referencias no resolubles y estructura no soportada. Los errores no incluyen el mensaje bruto del parser, URLs, nombres privados ni fragmentos XML. Diferenciar metadata no disponible de contrato incompatible.

Un árbol DOM consume más memoria que XML en bytes; se elige por simplicidad de navegación en metadata acotada, no por un benchmark de rendimiento. No se ha ejecutado el paquete candidato: sus propiedades se evaluaron mediante manifiesto, documentación y código público. La validación de seguridad efectiva es una condición de implementación, no un resultado de esta investigación.

## 6. Integración posterior y pruebas requeridas

El futuro ODataMetadataService utilizaría este lector aislado y devolvería exclusivamente un modelo normalizado. Podrá compartir caché/single-flight según la política que se apruebe de 008. No cambiaría ODataTransport, la representación Int64, paginación ni EXPORT. El TTL, recargas forzadas, condicionales y publicación de snapshots siguen siendo decisiones de implementación separadas; no se probó ETag/304 en esta investigación.

Pruebas sintéticas que deberán preceder a producción:

- XML equivalente con prefijos distintos, namespace por defecto, aliases, múltiples schemas/tipos y otra propiedad SUMA_NETA en un tipo ajeno.
- EntitySet exacto, ambigüedad de contenedor, tipo faltante, herencia válida/cíclica y duplicación de propiedades.
- Nullable omitido/false, facetas válidas/inválidas, Int64 frente a Decimal/String, anotaciones inline/externas y referencias necesarias no disponibles.
- 406 JSON, 200 con JSON de registros, HTML, namespace incorrecto, documento truncado y atributos duplicados: ningún éxito aparente.
- DTD, entidades internas/externas, profundidad/tamaño/atributos excesivos: rechazo acotado, sin red ni bloqueo del proceso; errores sin contenido sensible.
- Modelo vacío o proyección parcial, cambios compatibles y fallos que preservan el snapshot anterior. Mantener todas las regresiones CSV y numéricas.

No se ejecutó Jest: esta entrega solo añade documentación. Las **189 pruebas** son el último baseline registrado, no una ejecución nueva. Se ejecutaron las cinco sondas GET descritas, la resolución XML en memoria, las consultas públicas de bibliotecas y `git diff --check`. No hubo instalaciones, cambios de producción, modificación de credenciales/configuración, commit ni push.

## 7. Aprobación pendiente

Aprobar la estrategia única **CSDL XML + @xmldom/xmldom**, sus controles y la incorporación futura de la dependencia. Después podrán concretarse las pruebas del lector y la integración de 3B. Hasta esa autorización, no comenzar la implementación. Esta decisión no aprueba automáticamente TTL, nuevos contratos HTTP o cambios de política de caché propuestos en 008.
