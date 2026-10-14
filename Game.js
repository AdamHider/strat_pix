class Game {
    constructor(options) {
        this.canvas = options.canvas;
        this.tooltip = options.tooltip;
        this.mapGen = null;
        this.turnManager = null;
        this.factionsManager = null;
        this.diplomacyManager = null;

        this.state = null;
        this.aiManager = null;

        this.callbacks = {
            onRegionSelected: options.onRegionSelected || null,
            onArmySelected: options.onArmySelected || null,
            onGameReady: options.onGameReady || null,
            onTurnEnd: options.onTurnEnd || null,
            onSeasonChange: options.onSeasonChange || null,
            onFactionEliminated: options.onFactionEliminated || null,
            onWarDeclared: options.onWarDeclared || null,
            onPeaceMade: options.onPeaceMade || null,
            onAIAction: options.onAIAction || null,
        };
    }

    newGame(params) {
        const width = this.canvas.clientWidth || window.innerWidth;
        const height = this.canvas.clientHeight || window.innerHeight;

        this.mapGen = new MapGenerator({
            width, height,
            canvas: this.canvas,
            tooltip: this.tooltip,
            seed: params.seed,
            regionCount: params.regionCount,
            shapeType: params.shapeType,
            landAmount: params.landAmount,
            relief: params.relief,
            chaos: params.chaos,
            viewMode: 'political',
            factions: { count: params.factionCount, names: params.factionNames || null },
            onSelect: (region) => this._handleRegionSelected(region),
            onArmySelect: (army, reachableIds) => this._handleArmySelected(army, reachableIds),
        });
        this.mapGen.selection.onMoveRequest = (armyId, targetRegionId) => {
            const result = this.armyManager.moveArmy(armyId, targetRegionId);
            if (result.success) {
                this.mapGen.armies.select(armyId); // пересчитываем достижимую зону от новой позиции
            }
        };
        const { regions, factions: mapFactions } = this.mapGen.create(params.seed);

        this.factionsManager = new FactionsManager(this, {
            onFactionEliminated: (f) => { if (this.callbacks.onFactionEliminated) this.callbacks.onFactionEliminated(f); },
        });
        const enrichedFactions = this.factionsManager.init(mapFactions, params.playerFactionId ?? 0);
        
        this.armyManager = new ArmyManager(this, {
            onArmyMoved: (army, from, to) => { /* колбэк наружу при желании */ },
        });
        this.armyManager.initFromFactions(enrichedFactions);

        this.armyManager.resetActionPoints();
        this.mapGen.setArmiesProvider(() => this.armyManager.getArmiesSnapshot());
        
        this.diplomacyManager = new DiplomacyManager(this, {
            onWarDeclared: (a, b) => { if (this.callbacks.onWarDeclared) this.callbacks.onWarDeclared(a, b); },
            onPeaceMade: (a, b) => { if (this.callbacks.onPeaceMade) this.callbacks.onPeaceMade(a, b); },
        });
        this.diplomacyManager.init(enrichedFactions);

        this.mapGen.setDiplomaticColorResolver((factionId) => {
            const player = this.factionsManager.getPlayer();
            if (!player) return this.mapGen.factions.colors.neutral;
            if (factionId === player.id) return this.mapGen.factions.diplomacyColors.player;
        
            const status = this.diplomacyManager.getStatus(player.id, factionId);
            return this.mapGen.factions.diplomacyColors[status] || this.mapGen.factions.diplomacyColors.peace;
        });

        this.state = {
            regions,
            factions: enrichedFactions,
            playerFactionId: params.playerFactionId ?? 0,
            // diplomacy больше не плоский объект в state — читается через game.diplomacyManager
        };
       
        this.turnManager = new TurnManager(this, {
            turnsPerSeason: params.turnsPerSeason ?? 4,
            onTurnEnd: (summary) => { if (this.callbacks.onTurnEnd) this.callbacks.onTurnEnd(summary); },
            onSeasonChange: (season) => { if (this.callbacks.onSeasonChange) this.callbacks.onSeasonChange(season); },
        });

        this.aiManager = new AIManager(this, {
            onAIAction: (factionId, action, details) => {
                const faction = game.factionsManager.get(factionId);
                const log = document.getElementById('aiLog');
                log.classList.remove('hidden');
            
                const labels = {
                    declare_war: 'объявила войну',
                    make_peace: 'заключила мир с',
                    recruit_army: 'наняла армию',
                    capture_region: 'захватила территорию',
                    move_army: 'двинула армию',
                };
            
                let text = `${faction.name} ${labels[action]}`;
                if (action === 'declare_war' || action === 'make_peace') {
                    text += ' ' + game.factionsManager.get(details.target)?.name;
                }
            
                const line = document.createElement('div');
                line.textContent = text;
                log.prepend(line);
            },
            onFactionTurnStart: async (faction) => {
                if (skipAiAnimation) return;
                showAiTurnCard(faction);
                await sleep(aiTurnSpeed);
            },
            onFactionTurnEnd: async (faction) => {
                if (skipAiAnimation) return;
                const card = document.getElementById('aiTurnCard');
                card.style.opacity = '0';
                await sleep(120);
            },
        });
        const playerFaction = this.factionsManager.getPlayer();
        if (playerFaction) {
            this.mapGen.focusOnRegion(playerFaction.capitalRegionId);
            this.mapGen.setPlayerFaction(playerFaction.id);
        }
        const economies = this.mapGen.getAllFactionEconomies();
        this.turnManager._applyEconomies(economies);
        if (this.callbacks.onGameReady) this.callbacks.onGameReady(this.state);
        return this.state;
    }
    getRegionFullInfo(region) {
        const visible = this.mapGen.factions.computeVisibility(this.state.playerFactionId, this.mapGen.fogVisionHops ?? 2);
        if (!visible[region.id]) {
            return { region: { id: region.id, x: region.x, y: region.y }, hidden: true };
        }
        const faction = region.ownerId !== null ? this.factionsManager.get(region.ownerId) : null;
        const player = this.factionsManager.getPlayer();
    
        let diplomacy = null;
        if (faction && player && faction.id !== player.id) {
            diplomacy = this.getDiplomacyStatus(player.id, faction.id);
        }
        const armiesHere = faction
            ? faction.armies?.filter(a => a.regionId === region.id) ?? []
            : [];
    
        return {
            region,          // x, y, isWater, biome, climateZone, city, ownerId, population, resources
            temperature: this.mapGen.terrain.regions.all[region.id]?.temperature ?? null,
            elevation: this.mapGen.terrain.regions.all[region.id]?.t ?? null,
            faction,         // null если ничей
            diplomacy,       // null если faction === null или faction === player
            isPlayerOwned: faction?.isPlayer ?? false,
            armies: armiesHere,
        };
    }
    getPlayerForecast() {
        const player = this.factionsManager.getPlayer();
        if (!player) return null;
    
        const current = this.mapGen.getFactionEconomy(player.id);
        const forecast = this.mapGen.getFactionEconomyForecast(player.id);
    
        const armyUpkeep = this.armyManager.getArmiesOf(player.id)
            .reduce((sum, a) => sum + a.strength * this.armyManager.upkeepPerStrength, 0);
    
        const goldNextTurn = player.treasury.gold + forecast.gold - armyUpkeep;
    
        let manpowerDelta;
        if (forecast.food <= 0) {
            manpowerDelta = forecast.food * this.turnManager.starvationFactor;
        } else {
            manpowerDelta = forecast.manpower
                + forecast.food * this.turnManager.foodManpowerBonus
                + forecast.gold * this.turnManager.goldManpowerBonus;
        }
        const manpowerNextTurn = player.treasury.manpower + manpowerDelta;
    
        return {
            food: forecast.food,               // поток — не накопительный, показываем как есть
            production: forecast.production,   // поток
            ether: forecast.ether,   // поток
            gold: { current: player.treasury.gold, next: goldNextTurn, delta: goldNextTurn - player.treasury.gold },
            manpower: { current: player.treasury.manpower, next: manpowerNextTurn, delta: manpowerNextTurn - player.treasury.manpower },
        };
    }
    getFactionEconomyForecast(factionId) {
        const totals = { food: 0, production: 0, manpower: 0, ether: 0, gold: 0, upkeep: 0 };
    
        this.terrain.regions.all.forEach(region => {
            if (region.ownerId !== factionId) return;
            const res = this.getRegionResourcesForecast(region);
            if (!res) return;
            totals.food += res.food;
            totals.production += res.production;
            totals.ether += res.ether;
            totals.manpower += res.manpower;
            totals.gold += res.gold;
            totals.upkeep += res.upkeep;
        });
    
        return totals;
    }
    async endTurn() {
        this.mapGen.applyPendingSpecializations();
        this.mapGen.cultures.applyAssimilation();
        const summary = this.turnManager?.endTurn() ?? null;
    
        if (summary) {
            this.armyManager.collectUpkeep();
            this.factionsManager.checkElimination(this.mapGen);
            this.diplomacyManager.tick();

            await this.aiManager.runTurn(); // ← await
            this.armyManager.resolveOccupations();
            this.mapGen.updateExploredRegions();
            this.armyManager.resetActionPoints();
        }
        return summary;
    }

    // ── Дипломатия — тонкий проброс, чтобы UI не трогал diplomacyManager напрямую ──
    declareWar(a, b) {
        const result = this.diplomacyManager?.declareWar(a, b) ?? false;
        if (result) { this.mapGen.markDirty('political'); this.mapGen.render(); }
        return result;
    }

    makePeace(a, b) {
        const result = this.diplomacyManager?.makePeace(a, b) ?? false;
        if (result) { this.mapGen.markDirty('political'); this.mapGen.render(); }
        return result;
    }
    formAlliance(a, b) { return this.diplomacyManager?.formAlliance(a, b) ?? false; }
    getDiplomacyStatus(a, b) { return this.diplomacyManager?.getStatus(a, b) ?? 'peace'; }
    getRelationLevel(a, b) { return this.diplomacyManager?.getLevel(a, b) ?? 0; }

    getKnownFactions(factionId) {
        const neighbors = this.mapGen.factions.getNeighboringFactions(factionId);
        // "известные" = соседи + все, с кем уже была война (даже если больше не граничат)
        const atWarOrPeaceHistory = this.factionsManager.getAlive()
            .filter(f => f.id !== factionId)
            .filter(f => this.diplomacyManager.getStatus(factionId, f.id) !== 'peace' || neighbors.includes(f.id));
    
        const allKnownIds = new Set([...neighbors, ...atWarOrPeaceHistory.map(f => f.id)]);
        return [...allKnownIds].map(id => this.factionsManager.get(id)).filter(Boolean);
    }
    
    proposeAlliance(a, b) {
        const result = this.diplomacyManager?.formAlliance(a, b) ?? false;
        if (result) { this.mapGen.markDirty('political'); this.mapGen.render(); }
        return result;
    }



    _handleRegionSelected(region) {
        if (!region) return;
        if (this.callbacks.onRegionSelected) this.callbacks.onRegionSelected(region, this.state);
    }
    _handleArmySelected(army, reachableIds) {
        if (this.callbacks.onArmySelected) this.callbacks.onArmySelected(army, reachableIds, this.state);
    }

    setViewMode(mode) { this.mapGen?.setViewMode(mode); }
    setSeason(season) { this.mapGen?.setSeason(season); }
    setShowClimate(value) { this.mapGen?.setShowClimate(value); }
    zoomIn() { this.mapGen?.zoomIn(); }
    zoomOut() { this.mapGen?.zoomOut(); }
    resetView() { this.mapGen?.resetView(); }
    getSelectedRegion() { return this.mapGen?.getSelectedRegion() ?? null; }
}