/**
 * @fileoverview Middleware centralizado de manejo de errores
 */

module.exports = (err, req, res, next) => {
    if (res.headersSent) {
        console.error(JSON.stringify({ event: 'http_response_aborted', requestId: req.requestId }));
        return res.destroy();
    }
    if (err instanceof require('../services/ODataPaginationService').PaginationError || err instanceof require('../services/ODataSchemaError') || err instanceof require('../services/CsvSchemaService').SchemaError || err instanceof require('../utils/numeric').DataQualityError || err instanceof require('../services/ODataTransport').ODataTransportError) {
        return res.status(err.statusCode).json({
            success: false, error: err.message, code: err.code, details: err.details
        });
    }
    // Log only a server-generated correlation ID and a controlled status.
    const statusCode = [400, 413, 415, 502, 503].includes(err.statusCode) ? err.statusCode : 500;
    console.error(JSON.stringify({ event: 'http_error', requestId: req.requestId, status: statusCode }));
    const message = ({ 400: 'Solicitud inválida', 413: 'Cuerpo demasiado grande', 415: 'Formato no soportado' })[statusCode] || 'Error interno del servidor';

    // Enviamos respuesta estandarizada
    res.status(statusCode).json({
        success: false,
        error: message
    });
};
