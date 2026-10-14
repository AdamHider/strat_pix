class DiplomacyManager {
    constructor(game, options = {}) {
        this.game = game;
        this.relations = new Map(); // ключ "minId-maxId" → { status, turnsInStatus }

        this.callbacks = {
            onWarDeclared: options.onWarDeclared || null,
            onPeaceMade: options.onPeaceMade || null,
            onAllianceFormed: options.onAllianceFormed || null,
        };
    }

    _key(a, b) {
        return a < b ? `${a}-${b}` : `${b}-${a}`;
    }

    // Вызывается один раз в Game.newGame() — все живые фракции стартуют в мире
    init(factions) {
        this.relations.clear();
        for (let i = 0; i < factions.length; i++) {
            for (let j = i + 1; j < factions.length; j++) {
                const a = factions[i], b = factions[j];
                const culturalBonus = a.culture === b.culture ? 20 : -10; // культурная близость сразу влияет на старт
                this.relations.set(this._key(a.id, b.id), {
                    status: 'peace',
                    turnsInStatus: 0,
                    level: culturalBonus,
                });
            }
        }
    }
    
    getLevel(a, b) {
        if (a === b) return 100;
        const rel = this.relations.get(this._key(a, b));
        return rel ? Math.max(-100, Math.min(100, rel.level)) : 0;
    }
    
    adjustLevel(a, b, delta) {
        const rel = this.relations.get(this._key(a, b));
        if (!rel) return;
        rel.level = Math.max(-100, Math.min(100, rel.level + delta));
    }

    getStatus(a, b) {
        if (a === b) return 'self';
        const rel = this.relations.get(this._key(a, b));
        return rel ? rel.status : 'peace'; // fallback на случай новой фракции без записи
    }

    isAtWar(a, b) { return this.getStatus(a, b) === 'war'; }
    isAllied(a, b) { return this.getStatus(a, b) === 'alliance'; }

    // ── Переходы состояний — каждый со своей валидацией ──

    declareWar(a, b) {
        if (a === b) return false;
        const key = this._key(a, b);
        const rel = this.relations.get(key);
        if (!rel || rel.status === 'war') return false; // уже воюют — нет смысла объявлять снова

        rel.status = 'war';
        rel.turnsInStatus = 0;
        this.adjustLevel(a, b, -40); // резкое падение отношений при объявлении войны
        if (this.callbacks.onWarDeclared) this.callbacks.onWarDeclared(a, b);
        return true;
    }

    makePeace(a, b) {
        const key = this._key(a, b);
        const rel = this.relations.get(key);
        if (!rel || rel.status !== 'war') return false; // мириться можно только из состояния войны

        rel.status = 'peace';
        rel.turnsInStatus = 0;
        this.adjustLevel(a, b, 10); // небольшое улучшение при заключении мира
        if (this.callbacks.onPeaceMade) this.callbacks.onPeaceMade(a, b);
        return true;
    }

    formAlliance(a, b) {
        const key = this._key(a, b);
        const rel = this.relations.get(key);
        if (!rel || rel.status !== 'peace') return false; // союз можно заключить только из мира, не из войны

        rel.status = 'alliance';
        rel.turnsInStatus = 0;
        this.adjustLevel(a, b, 25);
        if (this.callbacks.onAllianceFormed) this.callbacks.onAllianceFormed(a, b);
        return true;
    }

    breakAlliance(a, b) {
        const key = this._key(a, b);
        const rel = this.relations.get(key);
        if (!rel || rel.status !== 'alliance') return false;

        rel.status = 'peace';
        rel.turnsInStatus = 0;
        return true;
    }

    // Вызывается из Turn на каждый ход — держит счётчик "сколько ходов в текущем статусе"
    tick() {
        this.relations.forEach(rel => {
            rel.turnsInStatus++;
            if (rel.status === 'war') rel.level = Math.max(-100, rel.level - 2);
            else if (rel.status === 'peace') rel.level = Math.min(100, rel.level + 1);
            else if (rel.status === 'alliance') rel.level = Math.min(100, rel.level + 2);
        });
    }

    // Все отношения конкретной фракции — удобно для AI/UI
    getRelationsOf(factionId) {
        const result = {};
        this.relations.forEach((rel, key) => {
            const [x, y] = key.split('-').map(Number);
            const otherId = x === factionId ? y : (y === factionId ? x : null);
            if (otherId !== null) result[otherId] = rel.status;
        });
        return result;
    }

    getFactionsAtWarWith(factionId) {
        const rel = this.getRelationsOf(factionId);
        return Object.keys(rel).map(Number).filter(id => rel[id] === 'war');
    }
}