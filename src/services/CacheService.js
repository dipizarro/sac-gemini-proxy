class CacheService {
    constructor() {
        this.cache = new Map();
    }

    /**
     * Recupera un valor de la caché.
     * @param {string} key 
     * @returns {any|null} El valor en caché o null si no existe/expiró.
     */
    get(key) {
        if (!this.cache.has(key)) return null;

        const entry = this.cache.get(key);
        if (Date.now() > entry.expiry) {
            this.cache.delete(key);
            return null;
        }

        return entry.value;
    }

    /**
     * Almacena un valor en la caché.
     * @param {string} key 
     * @param {any} value 
     * @param {number} ttlMs - Tiempo de vida en milisegundos (por defecto 10 mins).
     */
    set(key, value, ttlMs = 600000) {
        this.cache.set(key, {
            value,
            expiry: Date.now() + ttlMs
        });
    }

    /**
     * Elimina una clave de la caché.
     * @param {string} key 
     */
    del(key) {
        this.cache.delete(key);
    }

    /**
     * Limpia toda la caché.
     */
    flush() {
        this.cache.clear();
    }
}

module.exports = new CacheService();
