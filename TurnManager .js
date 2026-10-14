class TurnManager {
    constructor(game, options = {}) {
        this.game = game;
        this.turnsPerSeason = options.turnsPerSeason ?? 4;

        // экономические коэффициенты
        this.starvationFactor = options.starvationFactor ?? 1.0;   // насколько сильно голод бьёт по manpower
        this.foodManpowerBonus = options.foodManpowerBonus ?? 0.3;  // избыток еды ускоряет рост manpower
        this.goldManpowerBonus = options.goldManpowerBonus ?? 0.05; // золото слабо влияет на рост manpower (найм)

        this.state = { turnNumber: 1, seasonIndex: 0 };

        this.callbacks = {
            onTurnStart: options.onTurnStart || null,
            onTurnEnd: options.onTurnEnd || null,
            onSeasonChange: options.onSeasonChange || null,
        };
    }

    endTurn() {
        const mapGen = this.game.mapGen;
        if (!mapGen) return null;

        if (this.callbacks.onTurnStart) this.callbacks.onTurnStart(this.state.turnNumber);

        const economies = mapGen.getAllFactionEconomies();
        this._applyEconomies(economies);
        this._advanceSeasonIfNeeded(mapGen);

        this.state.turnNumber++;

        const summary = { turnNumber: this.state.turnNumber, economies };
        if (this.callbacks.onTurnEnd) this.callbacks.onTurnEnd(summary);
        return summary;
    }

    _applyEconomies(economies) {
        this.game.state.factions.forEach(faction => {
            const eco = economies[faction.id];
            if (!eco || !faction.treasury) return;

            // Золото — простое накопление дохода региона
            faction.treasury.gold += eco.gold;

            // Manpower — накопительный, но его ПРИРОСТ зависит от текущего потока еды/золота
            let manpowerDelta;
            if (eco.food <= 0) {
                // еды не хватает — население вымирает, manpower может уйти в минус
                manpowerDelta = eco.food * this.starvationFactor;
            } else {
                manpowerDelta = eco.manpower
                    + eco.food * this.foodManpowerBonus
                    + eco.gold * this.goldManpowerBonus;
            }
            faction.treasury.manpower += manpowerDelta;

            // Еда и производство — НЕ накопительные, это снимок текущего потока для UI/логики,
            // каждый ход перезаписывается заново из фактических владений, не суммируется с прошлым
            faction.currentFood = eco.food;
            faction.currentProduction = eco.production;
        });
    }

    _advanceSeasonIfNeeded(mapGen) {
        if (this.state.turnNumber % this.turnsPerSeason !== 0) return;
        this.state.seasonIndex = (this.state.seasonIndex + 1) % mapGen.seasonOrder.length;
        const newSeason = mapGen.seasonOrder[this.state.seasonIndex];
        mapGen.setSeason(newSeason);
        if (this.callbacks.onSeasonChange) this.callbacks.onSeasonChange(newSeason);
    }
}