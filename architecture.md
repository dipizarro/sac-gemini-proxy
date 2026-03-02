# Arquitectura del Proxy SAC-Gemini (Hybrid Query Engine)

## 1. Introducción y Motivación: Por qué una Arquitectura Híbrida

El objetivo de este proyecto es proveer una interfaz conversacional potente y confiable sobre los datos masivos de SAP Analytics Cloud (SAC) / SAP Datasphere (ej. reportes `MovMat`). Tras evaluar enfoques tradicionales basados íntegramente en LLMs (Large Language Models), se determinó que delegar en el modelo completo el razonamiento numérico y la agregación de miles de filas resulta en una merma drástica de rendimiento, altos costos y, críticamente, pérdida de exactitud matemática.

La **Arquitectura Híbrida** propuesta resuelve este dilema al separar el entendimiento del lenguaje natural (NLU) de la ejecución de la consulta de datos (Query Execution). Utilizamos el LLM (Gemini) **exclusivamente como un enrutador semántico y motor de síntesis**, mientras que el cómputo matemático y filtrado se delega a un motor de consultas determinista en Node.js estructurado en memoria pre-indexada (`QueryEngineService` e `InsightEngineService`).

## 2. Por qué NO enviar el CSV directamente al LLM

1. **Límites de Contexto (Token Limits):** Los reportes exportados desde SAC poseen frecuentemente la escala de cientos de miles de registros. Ingresar esta volumetría exhaustiva a la ventana de contexto de un LLM (incluso con ventanas largas) genera cuellos de botella severos de latencia, superando rápidamente los límites de tokens o aumentando prohibitivamente los costos por API call.
2. **Prevalencia de Alucinaciones Matemáticas:** Los modelos de lenguaje autorregresivos están diseñados y optimizados para predecir el siguiente token de texto más probable, no para realizar o auditar sumas, promedios, o group-by's deterministas sobre miles de celdas flotantes. Delegar una suma exacta sobre `SUMA_NETA` o transponer grandes grupos de datos típicamente resultará en aproximaciones o directamente invenciones (hallucinations).
3. **Privacidad y Payload Overhead:** Reducir la huella de PII (Personally Identifiable Information) o data propietaria de la empresa que cruza la red transaccional hacia la API externa.

## 3. Separación de Responsabilidades: Query Engine vs. Insight Engine

La capa de procesamiento local de datos fue escindida deliberadamente en dos motores especializados, reforzando la adherencia al *Single Responsibility Principle (SRP)*:

*   **`QueryEngineService` (Motor Determinista / Transaccional):**
    *   **Propósito:** Responder con precisión de reloj a consultas operativas estandarizadas. "Cuántos centros operaron hoy", "Cuál es la suma neta exacta para el grupo de artículos X en el período Y".
    *   **Técnica:** Utiliza índices invertidos por fechas (`IndexService`) y filtros directos de arrays estructurados `Array.filter/reduce` mediante tipos de dato numéricos estrictamente saneados (`toNumberSmart`). Resultando en un O(1) vía índices precalculados u O(n) rápido y seguro para validaciones.
    *   **Output:** Devuelve cifras certeras, que idealmente ni la IA reinterpreta o, si lo hace, debe ser citadas sin modificarse en el frontend mediante insignias visuales (badges).

*   **`InsightEngineService` (Motor Analítico Complejo):**
    *   **Propósito:** Responder a preguntas más abiertas, relacionales, o de prospección analítica que no tienen una respuesta simple. "Cuáles son las tendencias por trimestre", "Compara los meses de mayo vs junio respecto a volumen".
    *   **Técnica:** Ejecuta mapas temporales, set-differences (ej. conjuntos de materiales sin actividad entre periodos), cruce de dimensiones múltiples (Centro vs Grupo de Artículo over Time).
    *   **Output:** Devuelve resúmenes estadísticos ricos (tendencias, deltas absolutos/porcentuales, ganadores) que *posteriormente* se alimentan al LLM en un prompt como **contexto inyectado**. Así, el modelo razona la narrativa para el usuario partiendo de matemáticas previamente resueltas y consolidadas, dictando "por qué A es 20% más grande que B".

## 4. Control Integral de Alucinaciones (Hallucinations)

El ecosistema entero está acorazado contra alucinaciones de la IA bajo tres enfoques estratégicos:

1.  **Intent Router Estricto:** `IntentRouterService.js` no procesa las respuestas del usuario; procesa un *JSON estricto normado*. Identifica un `intent` (enumado) y extrae las *slots* requeridas (fechas, métricas, topN). Si Gemini no encuentra información explícita para popular un slot mandatorio, el enrutador fuerza un estado `needs_clarification=true`, forzando a la UI a preguntarle al usuario (ej. "¿Para qué fecha deseas consultar?"). La IA no puede "deducir erróneamente".
2.  **Context Injection Restringido:** Cuando el Motor Analítico termina la recolección matemática, el prompt dinámico al LLM adjunta el output analítico e indica estrucuralmente: *"Responde al usuario justificando el porqué, pero tus datos base son ESTOS {JSON}, no asumas cifras"*.
3.  **Auditoría y Transparencia de Evidencia (Frontend Badges):** Para las respuestas provenientes puramente del Motor Query, el sistema adjunta un campo `evidence` en el payload. El frontend renderiza un aviso `[⚡ Exact Query Engine]` y despliega un acordeón listando las "Filas de Muestra" computadas, ofreciendo trazabilidad instantánea al usuario final acerca de qué datos crudos se usaron para generar ese `1,340,920 USD`.

## 5. Arquitectura del Flujo de Datos

El ciclo de vida de una consulta (Chat Flow) obedece un pipeline unidireccional estricto:

1.  **Ingesta (WidgetController / ChatController):** El mensaje del usuario ingresa vía API (`/api/chat`).
2.  **Enriquecimiento Rápido Provisional (NLDateService):** Una extracción heurística/regex en español revisa el texto en O(1) para pre-identificar rangos de fechas obvios y ayudar a aligerar la carga al modelo.
3.  **Clasificación de Intención (IntentRouterService -> API Gemini):** Se envía el prompt taxonómico. Gemini retorna el mapa de la entidad/intentos vía JSON predecible.
4.  **Evaluación de Disparos de Clarificación:** Si el sistema determina `needs_clarification`, la iteración aborta tempranamente devolviendo una respuesta prescriptiva a la UI.
5.  **Data Fetch & Caching (DataService / CacheService):** Se carga el csv (o del buffer remoto en SAP Datasphere / NAS) y se retiene unificado en caché con vigencia temporal, reduciendo el FS throttling y optimizando la latencia.
6.  **Cómputo Local Híbrido:**
    *   *Si es un Query Simple:* El Payload ejecuta en memoria Node.js vía `QueryEngineService`. Resultados matemáticos devueltos directamente (Bypass de NLU final).
    *   *Si es Analítico:* `InsightEngineService` precalcula la matemática gruesa. Inyecta este macro-resumen validado a `GeminiService` (2da Instancia NLU). Gemini redacta la elocuencia y conclusión narrativa en base al JSON.
7.  **Respuesta Formateada:** El controller construye la respuesta homogénea estructurada y despacha al cliente web.

## 6. Estrategia de Defaults Inteligentes (Dataset Profiles)

Para mejorar la fluidez conversacional (ej. el usuario dice "dame las ventas" sin especificar qué mes o año):
Se elaboró el `DatasetProfileService`, el cual corre **en tiempo de inicialización de los datos (Cold Start / Cache miss)** barriendo todos los rangos temporales disponibles en el índice (`IndexService`).

Permite al `IntentRouterService` asumir variables como año actual (`defaultYear`), fecha inicial y límite del CSV. De este modo, ante la carencia de precisión por parte del usuario, se priorizan aserciones heurísticas ("Asumiendo año 2024 para la búsqueda") alertándoselo transparentemente como un array de `assumptions` retornado al cliente, reduciendo drásticamente las preguntas redundantes entre el bot y el analista de datos y optimizando los *API calls*.

## 7. Sumario de Decisiones Técnicas Clave

*   **Paso Paralelo `Csv-parse`:** Se emplea `csv-parse/sync` bajo estrategia optimizada contra strings gigantes en RAM, permitiendo flexibilidad (`relax_quotes`, `skip_empty_lines`) al lidiar con CSVs provenientes de SAP que sufren habitualmente de "Doble Header" por exportación contable mal saneada.
*   **Agnosticismo respecto a Nombres de Columnas:** Las funciones bases de los Engines (*helper* `_detectCols`) infieren lógicamente a las columnas clave mediante validaciones difusas o regex tolerantes (identifican que `FECHA`, `FE_REGISTRO`, contienen propósitos similares, etc.). Esto otorga resiliencia en un esquema proxy ante futuras reestructuraciones del CSV original emitido por el CDS u OData de Datasphere.
*   **Manejador de Errores Global Transaccional:** Middleware `errorHandler.js` único capturando toda excepción de tipo asíncrono para retornar respuestas uniformes, estandarizando validaciones y escondiendo Stack Traces de producción frente al cliente.
*   **Dependencia Mínima y Mantenibilidad:** Evitando sobre-ingenierías de bases de datos vectoriales pesadas (Pinecone o pgvector), o frameworks de agentes abstractos excesivos como LangChain o LlamaIndex donde no era indispensable (por el momento), privilegiando código JS vainilla conciso y predecible que los equipos de soporte de TI SAC/SAP pueden auditar tranquilamente.
