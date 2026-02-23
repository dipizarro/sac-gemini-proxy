const IndexService = require("./IndexService");
const CacheService = require("./CacheService");

const PROFILE_CACHE_KEY = "MOVMAT_PROFILE_V1";

class DatasetProfileService {
    /**
     * Extrae un perfil temporal del dataset cargado en memoria, permitiendo inferir
     * periodos por defecto cuando el usuario no provee fechas explícitas.
     */
    getDatasetProfile(rows) {
        if (!rows || rows.length === 0) {
            return {
                minDate: null,
                maxDate: null,
                years: [],
                defaultYear: new Date().getFullYear(),
                defaultFrom: null,
                defaultTo: null
            };
        }

        // 1. Intentar cargar desde caché
        const cached = CacheService.get(PROFILE_CACHE_KEY);
        if (cached) {
            return cached;
        }

        // 2. Extraer fechas
        const firstRow = rows[0];
        const cols = Object.keys(firstRow);
        const dateCol = cols.find(c => c === "FECHA") || cols.find(c => c.includes("FECHA")) || cols.find(c => c.includes("DATE"));

        if (!dateCol) {
            console.warn("DatasetProfileService: No se detectó columna de fecha.");
            return { minDate: null, maxDate: null, years: [], defaultYear: 2024 };
        }

        let minDate = "9999-12-31";
        let maxDate = "0000-01-01";
        const yearsSet = new Set();

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const rawDate = row[dateCol];
            const dateKey = IndexService.normalizeDate(rawDate); // "YYYY-MM-DD"

            if (dateKey >= "1900-01-01" && dateKey <= "2100-12-31") { // Validate reasonable bounds
                if (dateKey < minDate) minDate = dateKey;
                if (dateKey > maxDate) maxDate = dateKey;
                yearsSet.add(dateKey.substring(0, 4));
            }
        }

        const yearsArr = Array.from(yearsSet).map(y => parseInt(y, 10)).sort();

        let defaultYear;
        if (yearsArr.length === 1) {
            defaultYear = yearsArr[0];
        } else if (yearsArr.length > 1 && maxDate !== "0000-01-01") {
            defaultYear = parseInt(maxDate.substring(0, 4), 10);
        } else {
            defaultYear = new Date().getFullYear();
        }

        const profile = {
            minDate: minDate !== "9999-12-31" ? minDate : null,
            maxDate: maxDate !== "0000-01-01" ? maxDate : null,
            years: yearsArr,
            defaultYear,
            defaultFrom: minDate !== "9999-12-31" ? minDate : null,
            defaultTo: maxDate !== "0000-01-01" ? maxDate : null
        };

        // Cachear resultado por 24 horas
        CacheService.set(PROFILE_CACHE_KEY, profile, 24 * 60 * 60 * 1000);

        return profile;
    }

    clearProfileCache() {
        CacheService.del(PROFILE_CACHE_KEY);
    }
}

module.exports = new DatasetProfileService();
