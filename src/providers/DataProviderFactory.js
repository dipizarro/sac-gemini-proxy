const ODataProvider = require('./ODataProvider');
const CsvProvider = require('./CsvProvider');

function getDataProvider() {
    if (process.env.DATA_SOURCE === "ODATA") {
        console.log("[ProviderFactory] Usando OData Provider.");
        return ODataProvider;
    }
    console.log("[ProviderFactory] Usando CSV Provider.");
    return CsvProvider;
}

module.exports = {
    getDataProvider
};
