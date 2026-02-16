require('dotenv').config();
const DataService = require('./services/DataService');

(async () => {
    try {
        console.log('--- Testing DataService.fetchMovMat ---');
        console.log('1. Fetching Top 5 records...');

        // Test 1: Simple fetch
        const data = await DataService.fetchMovMat({ top: 5 });

        console.log('Status: OK');
        console.log('Response Type:', typeof data);

        // Attempt to detect OData response structure (value or d.results)
        const results = data.d?.results || data.value || data;

        if (Array.isArray(results)) {
            console.log(`Received ${results.length} records.`);
            if (results.length > 0) {
                console.log('Sample record:', JSON.stringify(results[0], null, 2));
            }
        } else {
            console.log('Received object (not an array directly):', JSON.stringify(data, null, 2).substring(0, 200));
        }

        // Test 2: Filter/Select (Optional verification if user provided correct fields, but at least we send the params)
        // We won't hardcode field names for filter unless we know them. 
        // We'll just print "Test 1 success" if we got valid JSON.

    } catch (error) {
        console.error('FAILED:', error.message);
        // Look for detailed error context
        if (error.cause) console.error('Cause:', error.cause);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
})();
