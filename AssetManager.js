class AssetManager {
    constructor(options = {}) {
        this.basePath = options.basePath || 'icons/';
        this.cache = new Map(); // key -> HTMLImageElement | null (null = точно не существует)
        this.pending = new Map(); // key -> Promise, для дедупликации параллельных запросов одного файла
        this.onAnyLoaded = options.onAnyLoaded || null; // колбэк для перерисовки при ленивой догрузке
    }

    // Загружает один файл по относительному пути (без basePath+extension логики — просто key.png)
    load(key) {
        if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
        if (this.pending.has(key)) return this.pending.get(key);

        const promise = new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                this.cache.set(key, img);
                this.pending.delete(key);
                if (this.onAnyLoaded) this.onAnyLoaded(key, img);
                resolve(img);
            };
            img.onerror = () => {
                this.cache.set(key, null); // помечаем как "точно нет" — не пытаемся снова
                this.pending.delete(key);
                resolve(null);
            };
            img.src = `${this.basePath}${key}.png`;
        });

        this.pending.set(key, promise);
        return promise;
    }

    // Загружает несколько ключей параллельно, ждёт всех
    loadBatch(keys) {
        return Promise.all(keys.map(k => this.load(k)));
    }

    // Синхронный доступ — если уже в кэше, отдаёт сразу; если нет — запускает загрузку в фоне и возвращает null на этот раз
    get(key) {
        if (this.cache.has(key)) return this.cache.get(key);
        this.load(key); // запускаем фоновую загрузку, следующий render() подхватит через onAnyLoaded
        return null;
    }

    isReady(key) {
        return this.cache.has(key) && this.cache.get(key) !== null;
    }
}