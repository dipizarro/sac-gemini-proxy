// Tipos verificados mediante CSDL real el 2026-11-05. No aplicar a CSV/EXPORT.
module.exports = Object.freeze({
    revision: 'movmat-odata-1',
    fields: Object.freeze({
        MATERIAL1: Object.freeze({ type: 'Edm.Int32', nullable: true }),
        FECHA: Object.freeze({ type: 'Edm.Date', nullable: false }),
        ID_CENTRO: Object.freeze({ type: 'Edm.String', nullable: false }),
        GRUPO_ARTICULOS: Object.freeze({ type: 'Edm.String', nullable: true }),
        CLASE_MOVIMIENTO: Object.freeze({ type: 'Edm.String', nullable: true }),
        SUMA_NETA: Object.freeze({ type: 'Edm.Int64', nullable: true })
    })
});
