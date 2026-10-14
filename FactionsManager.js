class FactionsManager {
    constructor(game, options = {}) {
        this.game = game;
        this.list = [];
        this.byId = new Map();

        this.callbacks = {
            onFactionEliminated: options.onFactionEliminated || null,
        };
    }

    // Вызывается один раз в Game.newGame(), сразу после mapGen.create()
    init(mapFactions, playerFactionId) {
        this.list = mapFactions.map(f => this._enrich(f, f.id === playerFactionId));
        this.byId = new Map(this.list.map(f => [f.id, f]));
        return this.list;
    }

    _enrich(mapFaction, isPlayer) {
        return {
            id: mapFaction.id,
            name: mapFaction.name,
            color: mapFaction.color,
            colorId: mapFaction.colorId,
            culture: mapFaction.culture,
            capitalRegionId: mapFaction.capitalRegionId,
            armies: mapFaction.armies || [],
            isPlayer,
            isAlive: true,
            personality: isPlayer ? null : this._randomPersonality(),
            treasury: { gold: 50, manpower: 100, ether: 50 },
            currentFood: 0, 
            currentProduction: 0,
        };
    }

    _randomPersonality() {
        // заготовка под AI — веса для будущих решений (война/дипломатия/экспансия)
        return {
            aggression: Math.random(),   // 0 миролюбивый .. 1 агрессивный
            expansion: Math.random(),    // 0 осторожный .. 1 экспансионист
            loyalty: Math.random(),      // 0 предательский .. 1 верный союзам
        };
    }

    get(factionId) {
        return this.byId.get(factionId) || null;
    }

    getPlayer() {
        return this.list.find(f => f.isPlayer) || null;
    }

    getAlive() {
        return this.list.filter(f => f.isAlive);
    }

    // Вызывается из Turn/эндтёрна — проверяет, не потеряла ли фракция все регионы
    checkElimination(mapGen) {
        this.list.forEach(faction => {
            if (!faction.isAlive) return;
            const stillHasRegions = mapGen.terrain.regions.all.some(r => r.ownerId === faction.id);
            if (!stillHasRegions) {
                faction.isAlive = false;
                if (this.callbacks.onFactionEliminated) this.callbacks.onFactionEliminated(faction);
            }
        });
    }
}