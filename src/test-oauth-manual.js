require('dotenv').config();
const { getAccessToken } = require('./services/OAuthService');

(async () => {
    try {
        console.log('--- Testing OAuthService ---');
        console.log('1. Solicitar Token inicial...');
        const start1 = Date.now();
        const token1 = await getAccessToken();
        const end1 = Date.now();
        console.log(`Token 1 recibido en ${end1 - start1}ms:`, token1 ? `${token1}` : 'NULL');

        console.log('\n2. Solicitar Token nuevamente (debe ser cacheado)...');
        const start2 = Date.now();
        const token2 = await getAccessToken();
        const end2 = Date.now();
        console.log(`Token 2 recibido en ${end2 - start2}ms:`, token2 ? `${token2}` : 'NULL');

        if (token1 === token2) {
            console.log('\nSUCCESS: Tokens coinciden (cache funcionando).');
        } else {
            console.error('\nFAIL: Tokens diferentes.');
        }

    } catch (error) {
        console.error('\nERROR:', error.message);
        process.exit(1);
    }
})();
