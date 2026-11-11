// Not run on import. Automated verification uses mocks; --live is an explicit operator action.
async function runManualCheck() {
    try {
        const { getAccessToken } = require('./services/OAuthService');
        const first = await getAccessToken();
        const second = await getAccessToken();
        console.log('Verificación OAuth completada; resultados coincidentes:', first === second);
        console.log('La caché y expiración se verifican con la suite automatizada.');
        return 0;
    } catch {
        console.error('No se pudo completar la verificación OAuth.');
        return 1;
    }
}
if (require.main === module) {
    if (process.argv.includes('--live')) runManualCheck().then(code => { process.exitCode = code; });
    else console.log('Sin solicitudes externas. Para una comprobación manual autorizada, use --live.');
}
module.exports = { runManualCheck };
