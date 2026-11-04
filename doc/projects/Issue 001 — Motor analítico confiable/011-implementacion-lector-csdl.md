# Issue 001 — Etapa 3B.1: lector seguro de CSDL XML

Fecha: 2026-11-04. Entrega local para revisión, sin commit ni push.

## 1. Resultado y alcance

Se incorpora un lector independiente y asíncrono de CSDL XML 4.0 que resuelve un EntitySet solicitado y devuelve su modelo estructural normalizado. No obtiene metadata por HTTP ni participa en cargas productivas. No se modificaron ODataProvider, DataService, ODataTransport, CSV, EXPORT, paginación, caché, perfiles numéricos ni contratos HTTP.

Suite completa ejecutada: **236/236 pruebas aprobadas, 12 suites**. Se conservan las 189 anteriores y se agregan 47 pruebas del lector. No se utilizó SAP ni metadata privada en las pruebas.

## 2. Arquitectura y archivos

| Archivo | Responsabilidad |
| --- | --- |
| `src/services/CsdlReader.js` | API pública, validación de opciones, límite de bytes, decodificación UTF-8 y lanzamiento del worker fijo. |
| `src/services/csdl/isolatedWorker.js` | Worker real, presupuesto de tiempo/heap, concurrencia máxima, terminación y saneamiento del resultado. API interna, no permite seleccionar archivos desde la API pública. |
| `src/services/csdl/worker.js` | DOMParser, límites estructurales, resolución CSDL y construcción del modelo. Solo recibe XML, selección y límites; no recibe credenciales ni entorno del proceso padre. |
| `src/services/csdl/errors.js` | Error público genérico y lista cerrada de razones; no propaga causas ni mensajes originales. |
| `tests/CsdlReader.test.js` | Fixtures sintéticas generadas en memoria, validación funcional, rechazo e integración real con workers. |
| `tests/fixtures/csdlBudgetWorker.js` | Exclusivamente para pruebas: bucle CPU y asignación de memoria para demostrar interrupción real. Nunca lo usa CsdlReader. |
| `package.json`, `package-lock.json` | Una dependencia nueva fijada exactamente; sin actualización general de paquetes. |

Git estaba limpio al comenzar. npm modificó además su lockfile oculto local dentro de node_modules; se restauró ese archivo a su contenido inicial para no incluirlo en la entrega. No se modificaron pruebas anteriores.

## 3. API y salida

Ejemplo sintético:

```js
const { read } = require('./src/services/CsdlReader');
const model = await read(xmlStringOrUtf8Buffer, {
    entitySet: 'Rows',
    container: 'Demo.Container', // opcional: nombre cualificado o Alias.Container
    limits: { timeoutMs: 1000 } // opcional: solo puede reducir los límites
});
```

entitySet se compara exactamente, incluyendo mayúsculas. Si el contenedor se omite, debe haber una única coincidencia entre los contenedores del documento. No se elige el primer tipo ni se busca SUMA_NETA globalmente. El lector no fija su tipo a Int64: devuelve Decimal si así lo declara el XML; la decisión de compatibilidad numérica corresponde a 3B.2.

Forma abreviada de salida para el fixture básico:

```json
{
  "version": "4.0",
  "container": "Demo.Container",
  "entitySet": "Rows",
  "entityType": "Demo.Row",
  "baseTypes": [],
  "properties": [{
    "name": "SUMA_NETA",
    "type": "Edm.Int64",
    "collection": false,
    "nullable": true,
    "nullableDeclared": false,
    "facets": {},
    "annotations": []
  }],
  "navigationProperties": [],
  "annotations": {
    "container": [],
    "entitySet": [],
    "types": [{ "target": "Demo.Row", "annotations": [] }]
  }
}
```

Type está cualificado; Collection se separa del tipo de elemento. Nullable omitido se normaliza a true para propiedades estructurales y navegación singular; en colección estructural describe nulabilidad de elementos. Para navegación de colección, nullable es null (no aplicable) y declarar Nullable se rechaza. nullableDeclared conserva la presencia del atributo.

facets contiene **facetas declaradas**, con nombres precision/scale/maxLength/unicode. No rellena defaults de Precision/Scale ni inventa escala en Int64. Se comprueban aplicabilidad, léxico entero completo, rango seguro, escala frente a precisión y precisión temporal máxima. Scale variable y MaxLength max permanecen textuales. Las facetas no soportadas se rechazan.

Las anotaciones inline y externas del target exacto conservan term cualificado, qualifier y expression. Las expresiones abreviadas mantienen kind/value; las expresiones XML admitidas mantienen kind/attributes/text/children. No se evalúan paths, etiquetas, moneda, aditividad ni unidades. La ausencia de expresión se conserva como null, sin resolver el default del término. Los namespaces de vocabularios externos pueden registrarse desde Include sin descargar su definición. El resultado es **interno**: contiene identidades y anotaciones del documento recibido y no debe publicarse ni registrarse íntegramente en logs.

## 4. Dependencia y revisión de seguridad

Instalada **`@xmldom/xmldom` 0.9.12**, versión exacta, CommonJS, sin dependencias transitivas de ejecución. El lockfile contiene URL pública e integridad del paquete. `npm ls @xmldom/xmldom --depth=0` confirmó esa versión. Se usó:

```powershell
npm install --save-exact @xmldom/xmldom@0.9.12 --ignore-scripts --no-audit --no-fund
```

Antes de instalar se revisaron los [avisos del mantenedor](https://github.com/xmldom/xmldom/security/advisories) y el [changelog 0.9.12](https://raw.githubusercontent.com/xmldom/xmldom/0.9.12/CHANGELOG.md). Esta versión incluye correcciones de consumo cuadrático por namespaces/atributos, recuperación malformada y diagnóstico de cierres inválidos. Se usa onError para rechazar también warnings y errores recuperables; no se confía en recibir un DOM como señal suficiente de validez. No se afirma ausencia universal de vulnerabilidades ni se ejecutó una remediación automática de dependencias.

## 5. Controles efectivamente probados

| Control | Implementación y evidencia |
| --- | --- |
| Entrada | Máximo 2 MiB UTF-8 antes de crear worker. Prueba con entrada superior al máximo; Buffer UTF-8 inválido rechazado. Declaración UTF-16 rechazada. |
| DTD/entidades | Rechazo conservador de declaraciones DOCTYPE/ENTITY antes de parsear, además de comprobar DocumentType. Pruebas de DTD simple, entidad interna, entidad no definida y DTD externo. No se usan regex para extraer CSDL. |
| Red | No hay cliente HTTP, resolver externo ni carga de referencias en el lector. Un servidor canario local recibió **cero peticiones** durante DTD externo y edmx:Reference; el tipo externo necesario no resuelto falló. |
| XML inválido | Truncamiento, atributo sin comillas, atributo duplicado, entidad no definida y cierre con contenido sobrante provocaron rechazo. Todos los diagnósticos del parser abortan. |
| Estructura | Máximo profundidad 64, 50.000 nodos y 128 atributos por nodo. Se probaron los tres controles con techos reducidos y un documento con 70 colecciones anidadas contra el techo normal. Los nodos incluyen documento/texto/comentarios. |
| Tiempo | Máximo 2.000 ms incluyendo arranque del worker; timer en hilo padre. Se probó timeout de lectura de 1 ms y bucle CPU real interrumpido a 500 ms. Un indicador compartido confirmó que el fixture de CPU llegó a ejecutarse. |
| Memoria | Worker con heap old generation de 32 MiB, young generation de 8 MiB y stack de 4 MiB. Una asignación creciente real produjo ERR_WORKER_OUT_OF_MEMORY, saneado como MEMORY_LIMIT. El fixture confirmó inicio efectivo. |
| Recuperación | Tras abortos de CPU y memoria, una nueva lectura correcta pasó. La promesa termina después de terminar el worker y liberar su cupo. |
| Concurrencia | Máximo dos workers activos por instancia del módulo; el tercero recibe BUSY. Prueba de saturación, terminación y recuperación de capacidad. No hay cola ilimitada. |
| Errores | Mensaje genérico, código CSDL_READER_ERROR y details.reason de lista cerrada. Sin causas, texto XML o mensajes originales; prueba con identificador secreto sintético. stdout/stderr del worker se consumen sin publicarlos. |
| Opciones | El llamador solo puede reducir presupuestos; valores desconocidos, inválidos o superiores a los máximos fallan. La ruta del worker y sus límites de heap no son parámetros de la API pública. |

Los límites de nodos/profundidad se comprueban después de construir DOM, dentro del worker. Por eso son necesarios el límite previo de bytes y los presupuestos externos de CPU/heap; el timer no se ejecuta en el hilo bloqueable del parser.

## 6. Subconjunto soportado y rechazos explícitos

Soportado: Edmx/DataServices/Schema con namespaces OASIS correctos y versión 4.0; múltiples schemas; Namespace y Alias; contenedor/set exactos; EntityType y cadena BaseType; propiedades primitivas declaradas en la lista del lector; colecciones primitivas y navegación a EntityType local; Nullable; facetas admitidas; referencias de claves simples a escalares no nullable; anotaciones sintácticas admitidas. El orden de propiedades es el declarado, precedido por las heredadas. No se normalizan nombres mediante reglas CSV.

Se detectan duplicados de declaraciones, alias ambiguos, miembros del contenedor, propiedades propias/heredadas y anotaciones del mismo término/qualifier. Repetir un nombre de propiedad en tipos distintos es válido. Una referencia necesaria faltante, herencia cíclica, set inexistente o ambiguo produce error específico.

Fuera de alcance, con rechazo si afecta al modelo seleccionado: OpenType, HasStream, herencia de contenedores, propiedades estructurales ComplexType/EnumType/TypeDefinition, tipos espaciales, DefaultValue, Partner/ContainsTarget y restricciones de navegación complejas, rutas compuestas de claves, expresiones de anotación no admitidas y versión 4.01. No se adapta silenciosamente lo desconocido. Tipos ajenos al seleccionado pueden existir sin que el lector interprete sus propiedades; no es un validador completo de todos los elementos del servicio. Las sobrecargas de Action/Function con identidad repetida se rechazan conservadoramente.

Razones principales: INVALID_XML, INVALID_STRUCTURE, UNSUPPORTED_VERSION, UNSUPPORTED_STRUCTURE, DUPLICATE_DECLARATION, UNRESOLVED_REFERENCE, CYCLIC_INHERITANCE, INVALID_FACET, ENTITY_SET_NOT_FOUND, AMBIGUOUS_ENTITY_SET y errores de presupuesto. No se asignan estados HTTP en este componente: la integración decidirá su traducción sin alterar los contratos actuales.

## 7. Resultados de pruebas y verificaciones

1. Baseline antes de producción: **189/189**, 11 suites.
2. Las 40 pruebas iniciales fallaron antes de existir el módulo. Además, la primera tabla parametrizada tenía filas de longitud desigual y Jest interpretó el parámetro ausente como done; se corrigió la tabla para suministrar siempre cuatro argumentos. Los timeouts de esa tabla fueron un defecto del harness, no evidencia sobre el parser. Una ejecución mínima previa también confirmó MODULE_NOT_FOUND.
3. Lector inicial y tabla corregida: **40/40** nuevas aprobadas.
4. Con identidad heredada, claves, nulabilidad, profundidad real y concurrencia: **45/45** nuevas aprobadas.
5. Suite completa final, incluyendo dos casos adicionales de XML recuperable y texto estructural: **236/236**, 12 suites, salida 0. Ningún caso anterior fue eliminado o modificado.

Comandos ejecutados:

```powershell
node node_modules/jest/bin/jest.js tests/CsdlReader.test.js --runInBand --silent --cache=false
node node_modules/jest/bin/jest.js --runInBand --silent --cache=false
npm ls @xmldom/xmldom --depth=0
git diff --check
git diff --stat
git status --short
```

Las pruebas HTTP/canario usaron permisos de loopback local. Las pruebas de presupuesto ejecutaron workers reales, no mocks. No se consultó SAP. El diff de dependencias incorpora solo el paquete aprobado; no hay cambios en los componentes productivos restringidos.

## 8. Limitaciones y preparación para 3B.2

- Un worker de Node no es un sandbox de sistema operativo ni un techo total de RSS. resourceLimits limita V8, no toda memoria nativa/ArrayBuffer. El lector ejecuta código fijo confiable, recibe entrada acotada y no carga código desde XML. La prueba de memoria acredita terminación del heap del worker, no inmunidad ante cualquier fallo nativo del proceso.
- No existe barrera de red del sistema operativo dentro del worker. La ausencia de red deriva del lector/parser sin resolver, del rechazo de DTD y de no descargar Reference; se verificaron esos caminos con un canario. No se ofrece ejecutar plugins o código arbitrario aislado.
- El filtro de declaraciones es deliberadamente conservador y puede rechazar comentarios que contengan literalmente una declaración prohibida. No se soportan otras codificaciones ni versiones CSDL automáticamente.
- No se hizo benchmark con metadata real. Los presupuestos pueden requerir revisión explícita si un documento legítimo excede límites; la API no permite aumentarlos por petición.
- Las anotaciones se conservan, pero no se valida su vocabulario ni se evalúan expresiones. Los modelos/salidas aún no se registran como snapshots ni se comparan contra requisitos del motor.

Para 3B.2: diseñar adquisición GET y caché de metadata, contrato esperado por operación/proyección, comparación de compatibilidad, contexto del snapshot y traducción saneada de errores. Usar este lector antes de publicar un candidato, manteniendo las protecciones de caché aprobadas. Esa integración **no está implementada** ni se ha realizado ninguna consulta remota durante esta etapa de código.
