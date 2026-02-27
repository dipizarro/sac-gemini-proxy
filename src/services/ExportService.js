const config = require('../config/config');
const OAuthService = require('./OAuthService');

class ExportService {

    /**
     * Función auxiliar para obtener la URL base de Exportación y validarla.
     */
    _getExportUrl() {
        const url = config.datasphere.exportUrl;
        if (!url) {
            throw new Error("Missing DATASPHERE_EXPORT_URL in config");
        }
        // Remover barra inclinada final si está presente
        return url.replace(/\/$/, "");
    }

    /**
     * Crea un job de exportación.
     * @param {Object} params
     * @param {string} params.resourcePath - Ruta al recurso de Datasphere (ej., "Space/View")
     * @param {string} [params.format='csv'] - Formato de exportación
     * @returns {Promise<string>} ID del Job
     */
    async createExportJob({ resourcePath, format = 'csv' }) {
        const token = await OAuthService.getAccessToken();
        const baseUrl = this._getExportUrl();
        const url = `${baseUrl}/jobs`; // Patrón REST estándar: POST /jobs

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ resourcePath, format })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to create export job: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const data = await response.json();
            // Asume que la respuesta contiene { id: "job-id" } o similar. Ajustar campo si la API difiere.
            if (!data.id && !data.jobId) {
                throw new Error(`Export job created but no ID returned. Response: ${JSON.stringify(data)}`);
            }
            return data.id || data.jobId;

        } catch (error) {
            throw new Error(`Create Export Job Error: ${error.message}`);
        }
    }

    /**
     * Consulta el estado del job hasta que se complete o se agote el tiempo.
     * @param {string} jobId
     * @param {Object} options
     * @param {number} [options.timeoutMs=300000] - Tiempo máximo de espera (por defecto 5 min)
     * @param {number} [options.intervalMs=5000] - Intervalo de consulta (por defecto 5 seg)
     */
    async waitExportJob(jobId, { timeoutMs = 300000, intervalMs = 5000 } = {}) {
        const token = await OAuthService.getAccessToken();
        const baseUrl = this._getExportUrl();
        const url = `${baseUrl}/jobs/${jobId}`;

        const startTime = Date.now();

        while (true) {
            if (Date.now() - startTime > timeoutMs) {
                throw new Error(`Export job ${jobId} timed out after ${timeoutMs}ms`);
            }

            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/json'
                    }
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    // Si es 404, ¿quizás aún no está listo? O asume error. Lanzamos error por ahora.
                    throw new Error(`Failed to check job status: ${response.status} ${response.statusText} - ${errorText}`);
                }

                const data = await response.json();
                const status = (data.status || "").toLowerCase();

                // Validar estados finales
                if (status === 'completed' || status === 'success') {
                    return data; // Job completado
                }
                if (status === 'failed' || status === 'error' || status === 'aborted') {
                    throw new Error(`Export job failed. Status: ${status}. Details: ${JSON.stringify(data)}`);
                }

                // Esperar antes de la próxima consulta
                await new Promise(resolve => setTimeout(resolve, intervalMs));

            } catch (error) {
                // Si hay error de red, podría reintentarse, pero por simplicidad relanzamos
                throw new Error(`Wait Export Job Error: ${error.message}`);
            }
        }
    }

    /**
     * Descarga el resultado de la exportación.
     * @param {string} jobId
     * @returns {Promise<Buffer>} Buffer del contenido del archivo
     */
    async downloadExport(jobId) {
        const token = await OAuthService.getAccessToken();
        const baseUrl = this._getExportUrl();
        // Asume que el endpoint es /jobs/{id}/data o /jobs/{id}/file
        const url = `${baseUrl}/jobs/${jobId}/data`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                    // No enviar Accept JSON, se espera un flujo binario/texto
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to download export: ${response.status} ${response.statusText} - ${errorText}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            return Buffer.from(arrayBuffer);

        } catch (error) {
            throw new Error(`Download Export Error: ${error.message}`);
        }
    }

    /**
     * Función auxiliar: Orquesta la creación, espera y descarga.
     * @param {Object} params
     * @param {string} params.resourcePath
     * @returns {Promise<Buffer>} Contenido CSV
     */
    async exportToCsvBuffer({ resourcePath }) {
        console.log(`[ExportService] Starting export for ${resourcePath}...`);

        // 1. Crear Job
        const jobId = await this.createExportJob({ resourcePath, format: 'csv' });
        console.log(`[ExportService] Job created: ${jobId}. Waiting...`);

        // 2. Esperar completitud
        await this.waitExportJob(jobId, { timeoutMs: 60000, intervalMs: 2000 });
        console.log(`[ExportService] Job ${jobId} completed. Downloading...`);

        // 3. Descargar
        const buffer = await this.downloadExport(jobId);
        console.log(`[ExportService] Download complete (${buffer.length} bytes).`);

        return buffer;
    }
}

module.exports = new ExportService();
