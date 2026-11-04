module.exports = Object.freeze({
    revision: 'movmat-csv-1',
    required: Object.freeze(['MATERIAL1', 'FECHA', 'ID_CENTRO', 'GRUPO_ARTICULOS', 'CLASE_MOVIMIENTO', 'SUMA_NETA']),
    // Layouts admitidos: cero, una o dos columnas iniciales de relleno vacío.
    leadingPadding: Object.freeze([0, 1, 2]),
    // Solo nombre explícito, nunca posición ni encabezado anónimo.
    metricAlias: 'COL_8'
});
