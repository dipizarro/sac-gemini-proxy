class CacheService {
    constructor() {
        this.cache = new Map();
    }

    /**
     * Retrieve a value from the cache.
     * @param {string} key 
     * @returns {any|null} The cached value or null if missing/expired.
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
     * Store a value in the cache.
     * @param {string} key 
     * @param {any} value 
     * @param {number} ttlMs - Time to live in milliseconds (default 10 mins).
     */
    set(key, value, ttlMs = 600000) {
        this.cache.set(key, {
            value,
            expiry: Date.now() + ttlMs
        });
    }

    /**
     * Delete a key from the cache.
     * @param {string} key 
     */
    del(key) {
        this.cache.delete(key);
    }

    /**
     * Clear all cache.
     */
    flush() {
        this.cache.clear();
    }
}

module.exports = new CacheService();
