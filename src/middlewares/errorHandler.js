/**
 * @fileoverview Middleware centralizado de manejo de errores
 */

module.exports = (err, req, res, next) => {
    if (err instanceof require('../services/ODataPaginationService').PaginationError || err instanceof require('../services/ODataSchemaError') || err instanceof require('../services/CsvSchemaService').SchemaError || err instanceof require('../utils/numeric').DataQualityError || err instanceof require('../services/ODataTransport').ODataTransportError) {
        return res.status(err.statusCode).json({
            success: false, error: err.message, code: err.code, details: err.details
        });
    }
    // Evitamos mostrar stack trace en consola en test para limpiar los logs, 
    // pero en dev/prod sí nos interesa ver qué tronó.
    console.error(`[Error] ${err.name || 'Failure'}: ${err.message}`, err.stack);

    const statusCode = err.statusCode || 500;
    const message = err.isOperational ? err.message : "Error interno del servidor";

    // Enviamos respuesta estandarizada
    res.status(statusCode).json({
        success: false,
        error: message,
        // Exponer el stack trace sólo si explícitamente estamos en desarrollo
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined
    });
};
