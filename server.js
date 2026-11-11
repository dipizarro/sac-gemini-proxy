const config = require('./src/config/config');
const { createApp } = require('./src/app');

if (require.main === module) {
    const server = createApp().listen(config.port, () => console.log('HTTP server listening'));
    server.headersTimeout = 15000;
    server.requestTimeout = 30000;
    server.keepAliveTimeout = 5000;
}
