const express = require('express');
const config = require('./config/config');
const { requestId, rateLimit, corsPolicy } = require('./middlewares/httpSecurity');

function createApp({ environment = process.env.NODE_ENV || 'development', allowedOrigins = config.cors.allowedOrigins, routes } = {}) {
    const policy = corsPolicy({ environment, allowedOrigins });
    const app = express();
    app.disable('x-powered-by');
    // Until the deployment topology is approved, never trust forwarded IPs.
    app.set('trust proxy', false);
    app.use(requestId);
    app.use(policy);
    app.use(rateLimit({ limit: 120 }));
    app.use((req, res, next) => req.method === 'OPTIONS' && req.headers.origin !== undefined ? res.sendStatus(204) : next());
    app.use(express.json({ limit: '100kb', inflate: false }));
    app.use('/', routes || require('./routes').createRouter());
    app.use((req, res) => res.status(404).json({ success: false, error: 'Ruta no encontrada' }));
    app.use(require('./middlewares/errorHandler'));
    return app;
}
module.exports = { createApp };
