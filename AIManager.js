class AIManager {
    constructor(game, options = {}) {
        this.game = game;
    
        this.weights = {
            warDesireBase: 0.35,           // было 0.15 — фракции чаще решаются на конфликт
            peaceDesireIfLosing: 0.5,       // чуть меньше, чтобы войны не гасли слишком быстро
            treasuryDangerThreshold: 8,     // порог "в беде" снижен — фракция терпит войну дольше
            recruitChance: 0.7,             // было 0.35 — почти каждый ход пытается нанять, если хватает средств
            recruitGoldReserve: 15,         // ниже резерв — тратит золото охотнее
            expansionChance: 0.5,          // было 0.7 — почти всегда пытается двигать свободные армии
            warCooldownTurns: 1,            // было 3 — почти без охлаждения между войнами
            maxSimultaneousWars: 2,         // новое — теперь можно воевать на 2 фронта, не на 1
            aggressiveMoveChance: 0.6,      // новое — шанс атаковать вражеский регион вместо нейтрального
            defenseGarrisonRatio: 0.4,     // доля армий, которые ИИ держит как гарнизон на границе, не отправляя в экспансию
            intentPersistence: true,  
        };
    
        this.callbacks = {
            onAIAction: options.onAIAction || null,
            onFactionTurnStart: options.onFactionTurnStart || null,
            onFactionTurnEnd: options.onFactionTurnEnd || null,
        };
    
        this.lastWarTurn = {};
    }

    async runTurn() {
        const factions = this.game.factionsManager.getAlive().filter(f => !f.isPlayer);
        for (const faction of factions) {
            if (this.callbacks.onFactionTurnStart) {
                await this.callbacks.onFactionTurnStart(faction); 
            }
    
            this._decideDiplomacy(faction);
            this._decideRecruitment(faction);
            this._decideArmyActions(faction);
    
            if (this.callbacks.onFactionTurnEnd) {
                await this.callbacks.onFactionTurnEnd(faction);
            }
        }
    }
    
    _decideArmyActions(faction) {
        const armies = this.game.armyManager.getArmiesOf(faction.id);
        if (!armies.length) return;
    
        // Разделяем армии на "гарнизон" (остаются защищать границу) и "свободные" (могут двигаться/атаковать)
        const borderRegions = this._getBorderRegions(faction);
        const garrisonCount = Math.ceil(armies.length * this.weights.defenseGarrisonRatio);
    
        armies.forEach((army, idx) => {
            if (army.actionPoints <= 0) return;
    
            const region = this.game.mapGen.terrain.regions.all[army.regionId];
            if (!region) return;
    
            const isGuardingBorder = borderRegions.has(army.regionId);
    
            // Армия уже на границе — считаем её гарнизоном, никуда не идёт без явной причины (угроза рядом)
            if (isGuardingBorder && idx < garrisonCount) {
                this._checkNearbyThreat(faction, army); // может атаковать соседа-врага прямо отсюда, но не уходит просто так
                return;
            }
    
            // Есть сохранённое намерение — продолжаем его, если цель всё ещё валидна
            if (this.weights.intentPersistence && army.aiIntent) {
                const stillValid = this._isIntentStillValid(faction, army);
                if (stillValid) {
                    this._pursueIntent(faction, army);
                    return;
                }
                army.aiIntent = null; // цель устарела (занята/уже своя) — выбираем новую ниже
            }
    
            if (Math.random() > this.weights.expansionChance) return;
    
            // Формируем НОВОЕ намерение и запоминаем его — не дёргаемся каждый ход заново
            const target = this._chooseNewIntent(faction, army);
            if (!target) return;
    
            army.aiIntent = { targetRegionId: target };
            this._pursueIntent(faction, army);
        });
    }
    
    // Регионы фракции, граничащие с чужой территорией — их стоит охранять, а не оголять экспансией
    _getBorderRegions(faction) {
        const mapGen = this.game.mapGen;
        const border = new Set();
        mapGen.terrain.regions.all.forEach(region => {
            if (region.ownerId !== faction.id) return;
            const hasForeignNeighbor = (mapGen.regionNeighbors[region.id] || []).some(nb => {
                const nbRegion = mapGen.terrain.regions.all[nb];
                return nbRegion.ownerId !== faction.id;
            });
            if (hasForeignNeighbor) border.add(region.id);
        });
        return border;
    }
    
    // Гарнизонная армия атакует, только если враг уже непосредственно на соседней клетке
    _checkNearbyThreat(faction, army) {
        const mapGen = this.game.mapGen;
        const neighbors = mapGen.regionNeighbors[army.regionId] || [];
        const enemyNeighbor = neighbors.find(nb => {
            const r = mapGen.terrain.regions.all[nb];
            return r.ownerId !== null && r.ownerId !== faction.id &&
                   this.game.getDiplomacyStatus(faction.id, r.ownerId) === 'war';
        });
        if (!enemyNeighbor) return;
        if (Math.random() > 0.5) return; // не бросается в бой каждый раз, оставляет пространство для манёвра ИИ-противника
    
        const result = this.game.armyManager.moveArmy(army.id, enemyNeighbor);
        if (result.success && this.callbacks.onAIAction) {
            this.callbacks.onAIAction(faction.id, 'move_army', { armyId: army.id, to: enemyNeighbor });
        }
    }
    
    _isIntentStillValid(faction, army) {
        const targetRegionId = army.aiIntent?.targetRegionId;
        if (targetRegionId === undefined) return false;
        const region = this.game.mapGen.terrain.regions.all[targetRegionId];
        if (!region) return false;
        if (region.ownerId === faction.id) return false; // уже наше — цель достигнута/устарела
        return true;
    }
    
    _pursueIntent(faction, army) {
        const targetRegionId = army.aiIntent.targetRegionId;
        const mapGen = this.game.mapGen;
        const reachable = mapGen.armies.computeReachable(army);
    
        // Двигаемся к цели ТОЛЬКО если можем дойти прямо сейчас; иначе — идём в сторону цели на один достижимый шаг
        if (reachable.has(targetRegionId)) {
            const result = this.game.armyManager.moveArmy(army.id, targetRegionId);
            if (result.success) {
                army.aiIntent = null; // достигли (или начали оккупацию) — намерение выполнено
                if (this.callbacks.onAIAction) this.callbacks.onAIAction(faction.id, 'move_army', { armyId: army.id, to: targetRegionId });
            }
            return;
        }
    
        // цель ещё далеко — делаем шаг в сторону неё среди достижимых регионов (минимизируем дистанцию до цели)
        const targetRegion = mapGen.terrain.regions.all[targetRegionId];
        let best = null, bestDist = Infinity;
        reachable.forEach((remainingAP, regionId) => {
            const r = mapGen.terrain.regions.all[regionId];
            const dist = Math.hypot(r.x - targetRegion.x, r.y - targetRegion.y);
            if (dist < bestDist) { bestDist = dist; best = regionId; }
        });
        if (!best) { army.aiIntent = null; return; }
    
        const result = this.game.armyManager.moveArmy(army.id, best);
        if (result.success && this.callbacks.onAIAction) {
            this.callbacks.onAIAction(faction.id, 'move_army', { armyId: army.id, to: best });
        }
    }
    
    _chooseNewIntent(faction, army) {
        // предпочитаем БЛИЖАЙШУЮ цель (не любую случайную из reachable) — устраняет "бросания далеко"
        const mapGen = this.game.mapGen;
        const reachable = mapGen.armies.computeReachable(army);
        if (!reachable.size) return null;
    
        let best = null, bestDist = Infinity;
        reachable.forEach((remainingAP, regionId) => {
            const region = mapGen.terrain.regions.all[regionId];
            if (!region) return;
    
            const isNeutral = region.ownerId === null || region.ownerId === undefined;
            const isEnemy = !isNeutral && region.ownerId !== faction.id &&
                             this.game.getDiplomacyStatus(faction.id, region.ownerId) === 'war';
            if (!isNeutral && !isEnemy) return;
            
            const dist = Math.hypot(region.x - mapGen.terrain.regions.all[army.regionId].x, region.y - mapGen.terrain.regions.all[army.regionId].y);
            if (dist < bestDist) { bestDist = dist; best = regionId; }
        });
        return best;
    }
    
    _findNearestEnemyRegion(faction, army) {
        const mapGen = this.game.mapGen;
        const reachable = mapGen.armies.computeReachable(army);
        if (!reachable.size) return null;
    
        let best = null, bestAP = -Infinity;
        reachable.forEach((remainingAP, regionId) => {
            const region = mapGen.terrain.regions.all[regionId];
            if (!region) return;
            if (region.ownerId === null || region.ownerId === undefined) return; 
            if (region.ownerId === faction.id) return;
            const status = this.game.getDiplomacyStatus(faction.id, region.ownerId);
            if (status !== 'war') return;
            if (remainingAP > bestAP) { bestAP = remainingAP; best = regionId; }
        });
        return best;
    }

    _decideDiplomacy(faction) {
        const neighbors = this.game.mapGen.factions.getNeighboringFactions(faction.id)
            .filter(id => this.game.factionsManager.get(id)?.isAlive);
        if (!neighbors.length) return;
    
        const inDanger = faction.treasury.gold < this.weights.treasuryDangerThreshold;
        if (inDanger) {
            const warEnemies = neighbors.filter(id => this.game.getDiplomacyStatus(faction.id, id) === 'war');
            warEnemies.forEach(enemyId => {
                if (Math.random() < this.weights.peaceDesireIfLosing) this._tryMakePeace(faction.id, enemyId);
            });
            return;
        }
    
        const currentTurn = this.game.turnManager?.state?.turnNumber ?? 0;
        const lastWar = this.lastWarTurn[faction.id] ?? -Infinity;
        if (currentTurn - lastWar < this.weights.warCooldownTurns) return;
    
        const currentWars = neighbors.filter(id => this.game.getDiplomacyStatus(faction.id, id) === 'war').length;
        if (currentWars >= this.weights.maxSimultaneousWars) return; // лимит фронтов, не полный запрет
    
        const peaceNeighbors = neighbors.filter(id => this.game.getDiplomacyStatus(faction.id, id) === 'peace');
        const shuffled = [...peaceNeighbors].sort(() => Math.random() - 0.5);
    
        let declaredThisTurn = 0;
        const remainingSlots = this.weights.maxSimultaneousWars - currentWars;
    
        for (const neighborId of shuffled) {
            if (declaredThisTurn >= remainingSlots) break;
            const level = this.game.getRelationLevel(faction.id, neighborId);
            const levelFactor = 1 - (level + 100) / 200; // 0 при +100 (не будет воевать), 1 при -100 (максимально готов)
            const chance = this.weights.warDesireBase * (faction.personality?.aggression ?? 0.5) * levelFactor;
            if (Math.random() < chance) {
                this._tryDeclareWar(faction.id, neighborId);
                this.lastWarTurn[faction.id] = currentTurn;
                declaredThisTurn++;
            }
        }
    }

    _decideRecruitment(faction) {
        if (Math.random() > this.weights.recruitChance) return;
    
        const cost = this.game.armyManager.recruitCost;
        if (faction.treasury.gold - cost.gold < this.weights.recruitGoldReserve) return;
        if (faction.treasury.manpower < cost.manpower) return;
    
        // выбираем случайный СВОЙ регион, не обязательно столицу — распределяет армии по территории, не только в центре
        const ownRegions = this.game.mapGen.terrain.regions.all.filter(r => r.ownerId === faction.id);
        if (!ownRegions.length) return;
    
        const target = Math.random() < 0.5
            ? this.game.mapGen.terrain.regions.all[faction.capitalRegionId]
            : ownRegions[Math.floor(Math.random() * ownRegions.length)];
    
        const result = this.game.armyManager.recruitArmy(faction.id, target.id);
        if (result.success && this.callbacks.onAIAction) {
            this.callbacks.onAIAction(faction.id, 'recruit_army', { regionId: target.id });
        }
    }

    _findNearestNeutralRegion(faction, army) {
        const mapGen = this.game.mapGen;
        const reachable = mapGen.armies.computeReachable(army);
        if (!reachable.size) return null;

        let best = null, bestAP = -Infinity; // предпочитаем цель, до которой останется больше очков (то есть ближе)
        reachable.forEach((remainingAP, regionId) => {
            const region = mapGen.terrain.regions.all[regionId];
            if (!region || region.ownerId !== null && region.ownerId !== undefined) return; // только нейтральные
            if (remainingAP > bestAP) { bestAP = remainingAP; best = regionId; }
        });
        return best;
    }

    _tryDeclareWar(a, b) {
        const success = this.game.declareWar(a, b);
        if (success && this.callbacks.onAIAction) this.callbacks.onAIAction(a, 'declare_war', { target: b });
    }

    _tryMakePeace(a, b) {
        const success = this.game.makePeace(a, b);
        if (success && this.callbacks.onAIAction) this.callbacks.onAIAction(a, 'make_peace', { target: b });
    }
}