const fs = require("fs");
const path = require("path");
const iconv = require("iconv-lite");
const { parse } = require("csv-parse/sync");
const { normalizeHeader } = require("../utils/helpers");

class CsvProvider {
    constructor() {
        this.csvPath = path.join(process.cwd(), "data", "3V_MM_MOVMAT_01_3M.csv");
    }

    async loadData() {
        if (!fs.existsSync(this.csvPath)) {
            throw new Error(`CSV file not found at ${this.csvPath}`);
        }
        const raw = fs.readFileSync(this.csvPath);
        const text = iconv.decode(raw, "utf8");
        const lines = text.split(/\r?\n/);

        // 1. Busca la fila del header real (la que contiene MATERIAL1)
        let headerIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes("MATERIAL1")) {
                headerIdx = i;
                break;
            }
        }

        if (headerIdx === -1) throw new Error("No encontré el header real (MATERIAL1) en el CSV.");

        // 2. Extraer el header base "h2"
        const h2Raw = lines[headerIdx];
        const h2Array = parse(h2Raw, { delimiter: ',', columns: false, relax_quotes: true })[0] || [];
        let finalHeaders = [...h2Array];
        let isDoubleHeader = false;

        // 3. Detectar si la fila inmediatamente superior tiene variables rezagadas como SUMA_NETA
        if (headerIdx > 0) {
            const lineAbove = lines[headerIdx - 1];
            if (lineAbove.includes("SUMA_NETA") || lineAbove.includes("Indicadores")) {
                isDoubleHeader = true;
                const h1Array = parse(lineAbove, { delimiter: ',', columns: false, relax_quotes: true })[0] || [];

                // Mezclamos rescatando valores de h1 sobre los huecos vacíos de h2
                for (let i = 0; i < h2Array.length; i++) {
                    const h2Val = h2Array[i] ? h2Array[i].trim() : "";
                    const h1Val = h1Array[i] ? h1Array[i].trim() : "";
                    if (h2Val === "" && h1Val !== "") {
                        finalHeaders[i] = h1Val;
                    }
                }
            }
        }

        // 4. Trimming de columnas basura al inicio (e.g. `,,MATERIAL1`)
        let leadingEmpty = 0;
        for (let i = 0; i < finalHeaders.length; i++) {
            if (!finalHeaders[i] || finalHeaders[i].trim() === "") {
                leadingEmpty++;
            } else {
                break;
            }
        }

        const normalizedHeaders = finalHeaders.slice(leadingEmpty).map(normalizeHeader);

        console.log(`[CSV] headerMode=${isDoubleHeader ? 'double' : 'single'}, leadingEmpty=${leadingEmpty}`);

        // 5. Unir y parsear sólamente la data en bruto post-header
        const dataStr = lines.slice(headerIdx + 1).join("\n");
        let rows = [];

        if (leadingEmpty > 0) {
            // Leer como array crudo (no dicta keys automáticamente) para rebanar columnas basura
            const rawRecords = parse(dataStr, {
                bom: true,
                delimiter: ",",
                skip_empty_lines: true,
                relax_quotes: true,
                relax_column_count: true,
                columns: false
            });

            rows = rawRecords.map(record => {
                const trimmedRecord = record.slice(leadingEmpty);
                const obj = {};
                normalizedHeaders.forEach((header, index) => {
                    obj[header] = trimmedRecord[index];
                });
                return obj;
            });
        } else {
            // Funcionamiento habitual limpio
            rows = parse(dataStr, {
                bom: true,
                delimiter: ",",
                skip_empty_lines: true,
                relax_quotes: true,
                relax_column_count: true,
                trim: true,
                columns: normalizedHeaders
            });
        }

        return rows;
    }
}

module.exports = new CsvProvider();
