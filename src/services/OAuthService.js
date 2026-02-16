const config = require('../config/config');

let cachedToken = null;
let tokenExpiration = 0;

/**
 * Obtiene un access token de Datasphere usando OAuth2 Client Credentials flow.
 * Cachea el token basado en 'expires_in'.
 * @returns {Promise<string>} Access Token
 */
async function getAccessToken() {
    // 1. Verificar cache (con margen de 60 segundos)
    const now = Date.now();
    if (cachedToken && tokenExpiration > now + 60000) {
        return cachedToken;
    }

    const { tokenUrl, clientId, clientSecret } = config.datasphere.oauth || {};

    if (!tokenUrl || !clientId || !clientSecret) {
        throw new Error("Missing OAuth configuration (DS_TOKEN_URL, DS_CLIENT_ID, DS_CLIENT_SECRET)");
    }

    try {
        // 2. Preparar request
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'client_credentials'
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OAuth request failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();

        if (!data.access_token) {
            throw new Error("OAuth response missing access_token");
        }

        // 3. Cachear token
        cachedToken = data.access_token;
        // expires_in viene en segundos. Convertimos a ms y sumamos a `now`.
        // Si no viene, asumimos un default corto o no cacheamos (aquí forzamos expires_in o 3600 como fallback seguro si no existe, aunque standard lo exige).
        const expiresIn = data.expires_in ? Number(data.expires_in) : 3600;
        tokenExpiration = now + (expiresIn * 1000);

        return cachedToken;

    } catch (error) {
        // Limpiar cache en error por seguridad
        cachedToken = null;
        tokenExpiration = 0;
        // Re-lanzar error con contexto pero SIN loguear secretos
        throw new Error(`Failed to obtain access token: ${error.message}`);
    }
}

module.exports = {
    getAccessToken
};
