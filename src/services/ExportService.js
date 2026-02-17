const config = require('../config/config');
const OAuthService = require('./OAuthService');

class ExportService {

    /**
     * Helper to get the base Export URL and validate it.
     */
    _getExportUrl() {
        const url = config.datasphere.exportUrl;
        if (!url) {
            throw new Error("Missing DATASPHERE_EXPORT_URL in config");
        }
        // Remove trailing slash if present
        return url.replace(/\/$/, "");
    }

    /**
     * Creates an export job.
     * @param {Object} params
     * @param {string} params.resourcePath - Path to the Datasphere resource (e.g., "Space/View")
     * @param {string} [params.format='csv'] - Export format
     * @returns {Promise<string>} Job ID
     */
    async createExportJob({ resourcePath, format = 'csv' }) {
        const token = await OAuthService.getAccessToken();
        const baseUrl = this._getExportUrl();
        const url = `${baseUrl}/jobs`; // Standard REST pattern: POST /jobs

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
            // Assume response contains { id: "job-id" } or similar. Adjust field name if API differs.
            if (!data.id && !data.jobId) {
                throw new Error(`Export job created but no ID returned. Response: ${JSON.stringify(data)}`);
            }
            return data.id || data.jobId;

        } catch (error) {
            throw new Error(`Create Export Job Error: ${error.message}`);
        }
    }

    /**
     * Polls the job status until completion or timeout.
     * @param {string} jobId
     * @param {Object} options
     * @param {number} [options.timeoutMs=300000] - Max wait time (default 5 min)
     * @param {number} [options.intervalMs=5000] - Polling interval (default 5 sec)
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
                    // If 404, maybe it's not ready yet? Or assumes error. We throw for now.
                    throw new Error(`Failed to check job status: ${response.status} ${response.statusText} - ${errorText}`);
                }

                const data = await response.json();
                const status = (data.status || "").toLowerCase();

                // Check terminal states
                if (status === 'completed' || status === 'success') {
                    return data; // Job done
                }
                if (status === 'failed' || status === 'error' || status === 'aborted') {
                    throw new Error(`Export job failed. Status: ${status}. Details: ${JSON.stringify(data)}`);
                }

                // Wait before next poll
                await new Promise(resolve => setTimeout(resolve, intervalMs));

            } catch (error) {
                // If network error, might want to retry, but for simplicity we rethrow wrap
                throw new Error(`Wait Export Job Error: ${error.message}`);
            }
        }
    }

    /**
     * Downloads the export result.
     * @param {string} jobId
     * @returns {Promise<Buffer>} File content buffer
     */
    async downloadExport(jobId) {
        const token = await OAuthService.getAccessToken();
        const baseUrl = this._getExportUrl();
        // Assume endpoint is /jobs/{id}/data or /jobs/{id}/file
        const url = `${baseUrl}/jobs/${jobId}/data`;

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                    // No Accept JSON, expecting binary/text stream
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
     * Helper: Orchestrates creation, waiting, and downloading.
     * @param {Object} params
     * @param {string} params.resourcePath
     * @returns {Promise<Buffer>} CSV content
     */
    async exportToCsvBuffer({ resourcePath }) {
        console.log(`[ExportService] Starting export for ${resourcePath}...`);

        // 1. Create Job
        const jobId = await this.createExportJob({ resourcePath, format: 'csv' });
        console.log(`[ExportService] Job created: ${jobId}. Waiting...`);

        // 2. Wait for completion
        await this.waitExportJob(jobId, { timeoutMs: 60000, intervalMs: 2000 });
        console.log(`[ExportService] Job ${jobId} completed. Downloading...`);

        // 3. Download
        const buffer = await this.downloadExport(jobId);
        console.log(`[ExportService] Download complete (${buffer.length} bytes).`);

        return buffer;
    }
}

module.exports = new ExportService();
