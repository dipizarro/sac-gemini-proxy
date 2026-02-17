const ExportService = require('../services/ExportService');
const { parse } = require('csv-parse/sync');
const { normalizeHeader } = require('../utils/helpers');

class ExportController {

    async getPreview(req, res) {
        try {
            const { resourcePath } = req.query;

            if (!resourcePath) {
                return res.status(400).json({ error: "Missing resourcePath query parameter" });
            }

            // 1. Activar la exportación y descarga
            // Nota: Esto puede tardar un tiempo. Para producción, considere trabajos en segundo plano o SSE.
            // Aquí bloqueamos según se solicite.
            const csvBuffer = await ExportService.exportToCsvBuffer({ resourcePath });

            // 2. Analizar CSV
            // Solo necesitamos una muestra, pero tenemos el búfer completo.
            // Lo analizamos todo o lo transmitimos. El análisis sincronizado es adecuado para tamaños moderados,
            // pero para archivos grandes puede ser pesado.
            // Optimización: ¿Analizar solo las primeras N líneas de la cadena?
            // Para simplificar y robustez, usar el analizador existente:

            const records = parse(csvBuffer, {
                columns: (header) => header.map(normalizeHeader),
                skip_empty_lines: true,
                trim: true,
                relax_quotes: true,
                // Para evitar analizar 1 millón de filas para una vista previa, podríamos establecer `en: 10`, pero csv-parse aún podría leer ampliamente.
                // Confiemos en el análisis estándar por ahora o cortemos la cadena del búfer si es necesario.
                to: 6 // Header + 5 rows
            });

            const count = records.length; // Este recuento estará limitado por `to`.
            // Espere, si limitamos `to`, no conocemos el recuento total.
            // El usuario solicitó "count" AND "sample".
            // Para obtener el recuento completo, necesitamos analizar todas las líneas O leerlas sin procesar.
            // "count" generalmente implica el total de filas en la exportación.

            // Reevaluando:
            // Opción A: Analizar todo. Recuento preciso. Lento si es grande.
            // Opción B: Analizar parcialmente. Count es solo el "tamaño de la muestra".

            // Analicemos todo por ahora para obtener el recuento real, suponiendo que las exportaciones para "preview" podrían filtrarse en el lado de Datasphere.
            // No, el usuario proporciona resourcePath. Podría ser enorme.
            // Analicemos todo, pero ¿quizás optimicemos?
            // En realidad, buffer.toString().split('\n').length podría ser una estimación aproximada.

            // Decisión: Usar el análisis completo para mayor seguridad en la estructura CSV, pero tenga cuidado con la memoria. // Si el búfer ya está en memoria (ExportService lo devolvió), ya pagamos el costo de memoria.
            // Por lo tanto, analizarlo implica un costo de CPU.
            const fullRecords = parse(csvBuffer, {
                columns: (header) => header.map(normalizeHeader),
                skip_empty_lines: true,
                trim: true,
                relax_quotes: true
            });

            const sample = fullRecords.slice(0, 5);

            return res.json({
                ok: true,
                count: fullRecords.length,
                sample
            });

        } catch (error) {
            console.error("Export Preview Error:", error);
            res.status(500).json({
                error: "Export Preview Failed",
                details: error.message
            });
        }
    }
}

module.exports = new ExportController();
