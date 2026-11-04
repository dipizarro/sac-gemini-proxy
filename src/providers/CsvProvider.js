const fs = require('fs');
const path = require('path');
const schema = require('../services/CsvSchemaService');
const numeric = require('../utils/numeric');
class CsvProvider {
    constructor() {
        this.csvPath = path.join(process.cwd(), 'data', '3V_MM_MOVMAT_01_3M.csv');
    }
    async loadData() {
        const decoded = schema.decode(fs.readFileSync(this.csvPath, 'utf8'));
        return numeric.registerValidatedCsv(decoded);
    }
}
module.exports = new CsvProvider();
