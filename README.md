# SAC Gemini Proxy

## Descripción Ejecutiva
SAC Gemini Proxy es un middleware backend desarrollado en Node.js y Express que actúa como puente inteligente entre las interfaces de usuario (como un widget conversacional) y los datos operativos (Movimientos de Materiales). Utiliza un enfoque híbrido de Motores de Consulta e Inteligencia Artificial (Google Gemini) para interpretar las preguntas en lenguaje natural de los usuarios, extraer parámetros (slots) y ejecutar cálculos deterministas sobre los datos. Esto permite obtener respuestas analíticas e insights de negocio con precisión absoluta y sin riesgo de alucinaciones.

## Arquitectura (Flujo Textual)
1. **Entrada:** El usuario envía una consulta en lenguaje natural a través del endpoint `/chat`.
2. **Enrutamiento de Intención (IntentRouterService):** Gemini procesa la pregunta bajo un prompt estricto para clasificarla en una de las intenciones predefinidas y extraer entidades clave (fechas, grupos, métricas).
3. **Ejecución (Motores):**
   - **Consultas Exactas:** Si la intención requiere un cálculo numérico exacto (ej. contar movimientos, sumar montos), se deriva al `QueryEngineService` para su cálculo determinista.
   - **Insights Analíticos:** Si la intención requiere cruzar datos (ej. comparar meses, diferencias de centros), se deriva al `InsightEngineService` que calcula los insights duros y luego Gemini los redacta.
   - **Consultas Abiertas:** Si la intención es desconocida, un prompt restrictivo solicita contexto al usuario o le sugiere funcionalidades soportadas.
4. **Respuesta:** El controlador empaqueta los resultados exactos o el texto redactado por la IA junto con los metadatos y evidencias (muestras de datos) hacia el cliente.

## Motores del Sistema
- **IntentRouterService:** Motor de NLP basado en LLM para la clasificación estricta de intenciones comerciales (14 casos de uso soportados) y Extracción de Entidades Nombradas (NER).
- **QueryEngineService:** Motor de cálculo determinista. Realiza operaciones matemáticas exactas (recuentos, sumas, top N) filtrando los datos directamente en memoria, garantizando 0% de error en cálculos.
- **InsightEngineService:** Motor analítico. Calcula variaciones porcentuales, diferencias de conjuntos y tendencias temporales (trimestrales/mensuales) mediante lógica algorítmica dura.
- **GeminiService:** Proxies de comunicación directa con las APIs de Google Gemini, utilizando modelos como `gemini-2.5-flash` para tareas de NLP puro y NLG (Natural Language Generation) a partir de JSONs estructurados.

## Variables de Entorno
Crea un archivo `.env` en la raíz del proyecto basándose en el siguiente formato:

```env
# Clave principal de la API de Google Gemini (Requerida para la IA)
GEMINI_API_KEY=AIzaSyB...

# Modelo de Google Gemini a utilizar (Por defecto: gemini-2.5-flash)
GEMINI_MODEL=gemini-2.5-flash

# Orígenes CORS permitidos separados por comas. Usar para desarrollo y producción
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000,https://tu-dominio.com

# Credenciales y endpoints de SAP Datasphere (Operaciones de exportación y proxy)
DATASPHERE_USER=usuario@dominio.com
DATASPHERE_PASS=ContraseñaSegura123
DATASPHERE_ODATA_URL=https://dominio.hcs.cloud.sap/api/v1/datasphere/...
```

## Ejecución Local

1. Instalar las dependencias (Asegurarse de tener Node.js instalado):
```bash
npm install
```

2. Configurar las variables de entorno:
Crear el archivo `.env` según la sección anterior de Variables de Entorno.

3. Iniciar el servidor de desarrollo:
```bash
npm start
```
El servidor escuchará por defecto en `http://localhost:3005` (según `src/config/config.js`).

## Endpoints Principales

### Core / Chat API
- `POST /chat`: Recibe historial y mensaje (`{ "message": "...", "history": [] }`), devuelve respuestas híbridas de IA/QueryEngine.
- `GET /health` : Endpoint de salud y diagnóstico ligero (`ok: true`).

### APIs de Datos (CSV & Insights)
- `GET /csv/status`: Retorna el estado en la caché de la fuente de datos CSV actual.
- `GET /csv/query/movements`: Retorna la cantidad de movimientos para una `date` (YYYY-MM-DD) específica.
- `GET /csv/query/top-centers`: Retorna el top N de centros con actividad dada una `date`.
- `GET /csv/query/suma-neta`: Calcula con precisión absoluta la SUMA_NETA por `date` y `group`.
- `GET /csv/insights/compare-months`: Interfaz directa API al InsightEngine para comparar actividad entre dos meses.

*Ver `src/routes/index.js` para la lista completa exhaustiva de subrutas analíticas.*

## Política Anti-Hallucination
El sistema implementa una arquitectura rigurosa para evitar las "alucinaciones" (datos inventados por el LLM) en escenarios financieros y operativos:

1. **Separación de Responsabilidades (NLP vs Matemáticas):** Gemini **nunca** calcula números ni filtra tablas. Su único rol inicial es leer la intención y extraer los filtros (ej. `{ intent: "sum_suma_neta...", slots: { date: "2024-01-01" } }`).
2. **Cálculos Deterministas Aislados:** Todas las métricas (sumas, conteos, top N, variaciones) ocurren mediante Javascript puro y directo en memoria a través de `QueryEngineService` e `InsightEngineService`.
3. **Data-to-Text Restringido:** Cuando el sistema necesita que la IA verbalice un Insight complejo, se inyecta en el prompt únicamente un bloque JSON validado generado por los motores de cálculo, y se le instruye expresamente: "*Responde SOLO usando los INSIGHTS entregados a continuación en formato JSON. No inventes cifras.*".
4. **Fallback Transparente:** Si la intención no es identificada o faltan parámetros clave (ej. intentar un cálculo comparativo sin especificar los meses), el router aborta la consulta y genera proactivamente una pregunta de clarificación al usuario en lugar de adivinar el dato faltante.

## Roadmap
- [ ] Implementar soporte para múltiples datasets simultáneos (cambio de contexto dinámico).
- [ ] Conectar exportaciones desde SAP Datasphere e integrarlas a caché automáticamente vía Cron Jobs.
- [ ] Escalar el cacheo en memoria pura (`DataService`) migrando a Redis para soporte multi-instancia.
- [ ] Evolucionar el motor de análisis (`InsightEngine`) para incorporar detección de anomalías algorítmicas (Standard Deviation).
- [ ] Ampliar las capacidades de extracción NER para rangos de fechas con lenguaje coloquial ("el puente del mes pasado").
