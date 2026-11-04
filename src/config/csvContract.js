module.exports = Object.freeze({
    revision: 'movmat-csv-2',
    required: Object.freeze(['MATERIAL1', 'FECHA', 'ID_CENTRO', 'GRUPO_ARTICULOS', 'CLASE_MOVIMIENTO', 'SUMA_NETA']),
    // Layouts admitidos: cero, una o dos columnas iniciales de relleno vacío.
    leadingPadding: Object.freeze([0, 1, 2])
    // Sin alias de métrica: no existe evidencia verificable de un layout histórico COL_8.
});
