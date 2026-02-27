const DataService = require("../services/DataService");
const GeminiService = require("../services/GeminiService");
const config = require("../config/config");

class ChatController {
    async handleChat(req, res, next) {
        try {
            const { message, history } = req.body || {};
            if (!message || typeof message !== "string") {
                return res.status(400).json({ error: "message is required (string)" });
            }

            const IntentRouterService = require("../services/IntentRouterService");
            const QueryEngineService = require("../services/QueryEngineService");

            // 1. Obtener datos cacheados
            const rows = await DataService.getRowsCached();

            // 2. Extraer intención usando Router (ahora con contexto del dataset para defaults)
            const route = await IntentRouterService.route(message, rows);
            console.log("IntentRouter Result:", route);
            // 3. Si falta información crucial, preguntar al usuario
            if (route.needs_clarification) {
                return res.json({
                    reply: route.clarification_question,
                    meta: {
                        engine: "router",
                        intent: route.intent,
                        needs_clarification: true
                    }
                });
            }

            // 4. Si es una consulta exacta soportada, usar Query Engine
            if (route.intent === "count_distinct_centers_by_date") {
                const dateKey = route.slots.date;
                const result = QueryEngineService.countDistinctCentersByDate(rows, dateKey);

                return res.json({
                    reply: `El ${result.date}, ${result.distinctCenters} centros tuvieron movimientos registrados.`,
                    meta: {
                        engine: "query",
                        exact: true,
                        intent: route.intent,
                        date: result.date
                    },
                    evidence: { sampleCenters: result.sampleCenters }
                });
            }

            if (route.intent === "count_movements_by_date") {
                const dateKey = route.slots.date;
                const result = QueryEngineService.countMovementsByDate(rows, dateKey);

                return res.json({
                    reply: `El ${result.date}, se registraron ${result.movements} movimientos.`,
                    meta: {
                        engine: "query",
                        exact: true,
                        intent: route.intent,
                        date: result.date
                    },
                    evidence: result.evidence
                });
            }

            if (route.intent === "top_centers_by_movements_on_date") {
                const dateKey = route.slots.date;
                const topN = route.slots.topN || 5;
                const result = QueryEngineService.topCentersByMovementsOnDate(rows, dateKey, topN);

                // Build a nice reply string
                let reply = `El ${result.date}, los ${result.topN} centros con más movimientos fueron:\n`;
                result.results.forEach((item, index) => {
                    reply += `${index + 1}) Centro ${item.center}: ${item.movements} movimientos\n`;
                });

                return res.json({
                    reply: reply.trim(),
                    meta: {
                        engine: "query",
                        exact: true,
                        intent: route.intent,
                        date: result.date,
                        topN: result.topN
                    },
                    data: result.results,
                    totals: result.totals,
                    evidence: result.evidence
                });
            }

            if (route.intent === "count_distinct_centers_by_date_range") {
                const { from, to } = route.slots;
                const result = QueryEngineService.countDistinctCentersByDateRange(rows, from, to);

                return res.json({
                    reply: `Entre el ${result.from} y el ${result.to}, ${result.distinctCenters} centros tuvieron movimientos registrados.`,
                    meta: {
                        engine: "query",
                        exact: true,
                        intent: route.intent,
                        from: result.from,
                        to: result.to
                    },
                    evidence: result.evidence
                });
            }

            if (route.intent === "sum_suma_neta_by_group_and_date") {
                const { date, group, breakdownByCenter } = route.slots;
                const result = QueryEngineService.sumSumaNetaByGroupAndDate(rows, date, group, { breakdownByCenter });

                if (result.error) {
                    return res.json({
                        reply: `Lo siento, no pude calcular esto: ${result.error}.`,
                        meta: { engine: "error", error: result.error }
                    });
                }

                const formatNum = (num) => new Intl.NumberFormat('es-CL').format(num);

                return res.json({
                    reply: `El ${result.date}, el grupo "${result.group}" sumó **${formatNum(result.totalSumaNeta)}** en volumen (centros operando: ${result.distinctCenters}).`,
                    meta: {
                        engine: "query",
                        exact: true,
                        intent: route.intent,
                        date: result.date,
                        group: result.group
                    },
                    data: {
                        totalSumaNeta: result.totalSumaNeta,
                        distinctCenters: result.distinctCenters,
                        topCenters: result.topCenters
                    }
                });
            }

            // 5. Soporte para AI Analysis con Insights (Sin alucinaciones)
            const insightIntents = [
                "compare_activity_by_months",
                "patterns_in_quarter",
                "max_active_centers_day",
                "prioritize_centers_over_period",
                "diff_distinct_centers_between_months",
                "compare_suma_neta_between_months",
                "distinct_centers_by_group_between_months",
                "materials_without_movements_feb_vs_jan",
                "compare_total_volume_between_months"
            ];

            if (insightIntents.includes(route.intent)) {
                const InsightEngineService = require("../services/InsightEngineService");
                let insights = null;
                let textReply = "";
                const monthNames = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

                if (route.intent === "compare_activity_by_months") {
                    insights = InsightEngineService.compareMonths(rows, route.slots.year, route.slots.months[0], route.slots.months[1], route.slots.metric);
                } else if (route.intent === "patterns_in_quarter") {
                    insights = InsightEngineService.quarterPatterns(rows, route.slots.year, route.slots.quarter);
                } else if (route.intent === "max_active_centers_day") {
                    insights = InsightEngineService.maxActiveCentersDay(rows, route.slots.year);
                } else if (route.intent === "prioritize_centers_over_period") {
                    insights = InsightEngineService.prioritizeCenters(rows, { year: route.slots.year });
                } else if (route.intent === "diff_distinct_centers_between_months") {
                    insights = InsightEngineService.diffDistinctCentersMonths(rows, route.slots.year, route.slots.months[0], route.slots.months[1]);

                    const nameA = monthNames[insights.monthA] || `Mes ${insights.monthA}`;
                    const nameB = monthNames[insights.monthB] || `Mes ${insights.monthB}`;

                    // Template hardcodeado en vez de llamar a LLM
                    textReply = `En ${insights.year}, ${nameB} tuvo ${insights.distinctCentersB} centros con movimiento vs ${nameA} que tuvo ${insights.distinctCentersA} (diferencia: ${Math.abs(insights.diff)}).`;

                    if (route.assumptions && route.assumptions.length > 0) {
                        textReply += "\n\n*(Nota: " + route.assumptions.join(", ") + ")*";
                    }

                    return res.json({
                        reply: textReply,
                        meta: { engine: "insight", intent: route.intent, metric: "distinctCenters", assumptions: route.assumptions },
                        data: insights
                    });
                } else if (route.intent === "compare_suma_neta_between_months") {
                    insights = InsightEngineService.compareSumaNetaMonths(rows, route.slots.year, route.slots.months[0], route.slots.months[1]);

                    if (insights.error === "MISSING_METRIC_SUMANETA") {
                        return res.json({
                            reply: "Lo siento, este archivo de datos actual no contiene la columna de montos o volúmenes esperada ('SUMA_NETA') para realizar esta comparativa.",
                            meta: { engine: "insight", intent: route.intent, metric: "sumaNeta", error: insights.error }
                        });
                    }

                    const nameA = monthNames[insights.monthA] || `Mes ${insights.monthA}`;
                    const nameB = monthNames[insights.monthB] || `Mes ${insights.monthB}`;

                    const formatNum = (num) => new Intl.NumberFormat('es-CL').format(num);
                    const winnerName = (insights.winner === "Mes A") ? nameA : (insights.winner === "Mes B") ? nameB : "Ambos (Empate)";

                    textReply = `Entre ${nameA} y ${nameB} de ${insights.year}, el mayor volumen total (SUMA_NETA) fue de **${winnerName}**.\n\n`;
                    textReply += `| Mes | Volumen Agrupado |\n`;
                    textReply += `|---|---|\n`;
                    textReply += `| ${nameA.charAt(0).toUpperCase() + nameA.slice(1)} | ${formatNum(insights.sumA)} |\n`;
                    textReply += `| ${nameB.charAt(0).toUpperCase() + nameB.slice(1)} | ${formatNum(insights.sumB)} |\n`;
                    textReply += `| **Diferencia** | **${formatNum(insights.diffAbs)}** (${insights.diffPct.toFixed(1)}%) |\n`;

                    if (route.assumptions && route.assumptions.length > 0) {
                        textReply += "\n*(Nota: " + route.assumptions.join(", ") + ")*";
                    }

                    return res.json({
                        reply: textReply,
                        meta: { engine: "insight", intent: route.intent, metric: "sumaNeta", assumptions: route.assumptions },
                        data: insights
                    });
                } else if (route.intent === "distinct_centers_by_group_between_months") {
                    const monthStart = route.slots.months[0];
                    const monthEnd = route.slots.months[route.slots.months.length - 1]; // Toma el último
                    insights = InsightEngineService.distinctCentersByGroupMonths(rows, route.slots.year, monthStart, monthEnd, route.slots.group);

                    if (insights.error === "MISSING_DIM_GROUP") {
                        return res.json({
                            reply: "Lo siento, en este archivo no logré detectar una columna descriptiva que contenga los Grupos de Artículos o Materiales.",
                            meta: { engine: "insight", intent: route.intent, error: insights.error }
                        });
                    }

                    const nameA = monthNames[insights.monthA] || `Mes ${insights.monthA}`;
                    const nameB = monthNames[insights.monthB] || `Mes ${insights.monthB}`;
                    const capGroup = insights.group.toUpperCase();

                    textReply = `Entre ${nameA} y ${nameB} de ${insights.year}, el grupo **'${capGroup}'** tuvo movimientos en **${insights.totalDistinctCenters}** centros únicos.\n`;
                    textReply += `- Desglose: ${nameA} (${insights.monthADistinctCenters}), ${nameB} (${insights.monthBDistinctCenters})`;

                    if (route.assumptions && route.assumptions.length > 0) {
                        textReply += "\n\n*(Nota: " + route.assumptions.join(", ") + ")*";
                    }

                    return res.json({
                        reply: textReply,
                        meta: { engine: "insight", intent: route.intent, metric: "distinctCenters", assumptions: route.assumptions },
                        data: insights
                    });
                } else if (route.intent === "materials_without_movements_feb_vs_jan") {
                    insights = InsightEngineService.materialsWithoutMovementsMonths(rows, route.slots.year, route.slots.months[0], route.slots.months[1]);

                    if (insights.error === "MISSING_DIM_MATERIAL") {
                        return res.json({
                            reply: "Lo siento, este archivo no parece contener una columna descriptiva o ID de los Materiales / Artículos para cruzarlos.",
                            meta: { engine: "insight", intent: route.intent, error: insights.error }
                        });
                    }

                    const nameA = monthNames[insights.monthA] || `Mes ${insights.monthA}`;
                    const nameB = monthNames[insights.monthB] || `Mes ${insights.monthB}`;

                    textReply = `Entre ${nameA} y ${nameB} de ${insights.year}, hubo **${insights.countOnlyA}** artículos que operaron en ${nameA} y dejaron de tener salida en ${nameB}.\n`;
                    if (insights.countOnlyA > 0) {
                        textReply += `\nMuestra de materiales (${insights.sampleOnlyA.length}): ${insights.sampleOnlyA.join(", ")}.\n`;
                    }

                    textReply += `\n*(Opcional) A la inversa: ${insights.countOnlyB} artículos operaron en ${nameB} pero no en ${nameA}.*`;
                    textReply += `\n\n💡 **Sugerencia:** ¿Quieres que lo exporte o que lo filtre por centro?`;

                    if (route.assumptions && route.assumptions.length > 0) {
                        textReply += `\n\n*(Nota: ${route.assumptions.join(", ")})*`;
                    }

                    return res.json({
                        reply: textReply,
                        meta: { engine: "insight", intent: route.intent, metric: "setDifference", assumptions: route.assumptions },
                        data: insights
                    });
                } else if (route.intent === "compare_total_volume_between_months") {
                    insights = InsightEngineService.compareTotalVolumeBetweenMonths(rows, route.slots.year, route.slots.months[0], route.slots.months[1], route.slots.volumeMetric);

                    if (insights.error === "MISSING_VOLUME_METRIC") {
                        return res.json({
                            reply: "No puedo calcular volumen total porque el CSV no trae una columna de volumen (ej: CANTIDAD/IMPORTE). ¿Qué métrica deseas usar?",
                            meta: { engine: "insight", intent: route.intent, error: insights.error }
                        });
                    }

                    const nameA = monthNames[insights.monthA] || `Mes ${insights.monthA}`;
                    const nameB = monthNames[insights.monthB] || `Mes ${insights.monthB}`;
                    const formatNum = (num) => new Intl.NumberFormat('es-CL').format(num);
                    const winnerName = (insights.winnerMonth === "Mes A") ? nameA : (insights.winnerMonth === "Mes B") ? nameB : "Ambos (Empate)";

                    textReply = `Entre ${nameA} y ${nameB} de ${insights.year}, el mayor volumen total (${insights.metricKey}) fue de **${winnerName}**.\n\n`;
                    textReply += `| Mes | Volumen Agrupado |\n`;
                    textReply += `|---|---|\n`;
                    textReply += `| ${nameA.charAt(0).toUpperCase() + nameA.slice(1)} | ${formatNum(insights.a.volumeTotal)} |\n`;
                    textReply += `| ${nameB.charAt(0).toUpperCase() + nameB.slice(1)} | ${formatNum(insights.b.volumeTotal)} |\n`;
                    textReply += `| **Diferencia** | **${formatNum(insights.diffAbs)}** (${insights.diffPct.toFixed(1)}%) |\n`;

                    if (route.assumptions && route.assumptions.length > 0) {
                        textReply += "\n*(Nota: " + route.assumptions.join(", ") + ")*";
                    }

                    return res.json({
                        reply: textReply,
                        meta: { engine: "insight", intent: route.intent, metric: "totalVolume", metricKey: insights.metricKey, assumptions: route.assumptions },
                        data: insights
                    });
                }

                // Prompt estricto instruyendo a Gemini a solo redactar sobre estos insights
                const strictPrompt = `
                Responde SOLO usando los INSIGHTS entregados a continuación en formato JSON.
                No digas 'no tengo acceso'. No pidas consultar reportes. Si notas que falta algo grave en el JSON, haz UNA pregunta de aclaración.
                Redacta un texto claro y directo, usando 2-4 bullets con cifras.
                Si estás comparando meses, incluye el ganador.
                
                JSON INSIGHTS:
                ${JSON.stringify(insights, null, 2)}
                `;

                const aiResponse = await GeminiService.generateResponse(message, history, strictPrompt);
                textReply = aiResponse.reply;

                // UX: Fallback de seguridad por si Gemini se disculpa
                const excusas = ["no tengo acceso", "necesitaría consultar", "por favor proporcione", "no puedo determinar"];
                if (excusas.some(exc => textReply.toLowerCase().includes(exc))) {
                    textReply = "Para responder con exactitud, indícame el periodo o revisa tu consulta.";
                }

                // Anexar defaults de contexto (Profile Defaults)
                if (route.assumptions && route.assumptions.length > 0) {
                    textReply += "\n\n*(Nota: " + route.assumptions.join(", ") + ")*";
                }

                return res.json({
                    reply: textReply,
                    meta: { engine: "ai", intent: route.intent, insights_provided: true, assumptions: route.assumptions }
                });
            }

            // 6. Si la intención es unknown o totalmente fuera del radar
            const context = `
            Eres un asistente experto en el reporte de Movimientos de Materiales.
            El usuario hace una pregunta general o fuera del flujo de consulta exacta, o pide operaciones sobre datos a las cuales no tienes acceso actualmente.
            Responde de forma profesional y amable. 
            Si te piden un dato exacto (como "dame la suma" o "cuántos litros de X"), explica cortésmente que aún no tienes habilitada esa consulta específica en el motor, y sugiere consultar sobre lo que sí puedes hacer (ej: comparar volumen total entre meses, diferencias de centros activos, días pico del año, o top 5 centros).
            POR NINGÚN MOTIVO inventes cifras, ni incluyas placeholders como "[Valor]".
            `;


            const response = await GeminiService.generateResponse(message, history, context);
            return res.json({
                ...response,
                meta: { engine: "ai", intent: route.intent }
            });

        } catch (err) {
            next(err);
        }
    }

    async proxyDatasphere(req, res, next) {
        try {
            const url = `${config.datasphere.url}?$top=50&$format=json`;
            const auth = Buffer.from(`${config.datasphere.user}:${config.datasphere.pass}`).toString("base64");

            const r = await fetch(url, {
                headers: {
                    Authorization: `Basic ${auth}`,
                    Accept: "application/json"
                }
            });

            const text = await r.text();
            res.status(r.status).type("application/json").send(text);
        } catch (err) {
            next(err);
        }
    }
}

module.exports = new ChatController();
