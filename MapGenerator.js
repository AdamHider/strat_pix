class MapGenerator {
    constructor(options = {}) {
        this.width = options.width || 600;
        this.height = options.height || 600;
        this.borderMargin = options.borderMargin || 22;

        this.showClimate = options.showClimate ?? true;
        this.currentSeason = options.currentSeason ?? 'SUMMER';
        this.viewMode = options.viewMode ?? 'terrain';

        this.canvas = options.canvas;
        this.ctx = this.canvas.getContext('2d');

        this.initialSeed = options.seed || 12345;
        this.currentSeed = this.initialSeed;
        this.mapVoronoi = null;
        this.noisyEdgeCache = new Map();


        this._isPanning = false;
        this._panStart = { x: 0, y: 0 };
        this.viewTransform = { x: 0, y: 0, scale: 1 };
        this.minScale = 0.6;
        this.maxScale = 10;

        this._renderScheduled = false;
        this.mapLayerScale = 6;
        this.sharpRegionBudget = 120;

        this.viewLevel = 'overview';
        this.layers = {
            terrain: this._createLayer(),
            political: this._createLayer(),
            fog: this._createLayer(),
        };
        this.fogEnabled = options.fogEnabled ?? false;
        this.fogColor = 'rgba(5, 8, 15, 0.52)';
        this.globalRegionThreshold = options.globalRegionThreshold ?? 800;
        this.exploredRegions = new Set();


        this.detailCache = {
            canvas: document.createElement('canvas'),
            ctx: null,
            valid: false,
            coveredRect: null,
            scale: 1,
        };
        this.detailCache.ctx = this.detailCache.canvas.getContext('2d');

        this.color = {
            getBase: MapColor.getBase.bind(this),
            getGrayscale: MapColor.getGrayscale.bind(this),
            getResourceRange: MapColor.getResourceRange.bind(this),
            getResourceColor: MapColor.getResourceColor.bind(this),
            hexToRgb: MapColor.hexToRgb.bind(this),
            rgbToHex: MapColor.rgbToHex.bind(this),
            hslToHex: MapColor.hslToHex.bind(this),
            blend: MapColor.blend.bind(this)
        };

        this.interaction = {
            wheelDebounceTimer: null,
            initEvents: MapInteraction.initEvents.bind(this),
            handlePointerAt: MapInteraction.handlePointerAt.bind(this),
            _handleWheel: MapInteraction._handleWheel.bind(this),
            _handleMouseDown: MapInteraction._handleMouseDown.bind(this),
            _handleMouseUp: MapInteraction._handleMouseUp.bind(this),
            _handleMouseMove: MapInteraction._handleMouseMove.bind(this),
            selectRegionAt: MapInteraction.selectRegionAt.bind(this),
        }

        this.selection = {
            regionId: null,
            armyId: null,
            color: '#fff200',
            onSelect: options.onSelect || null,
            onArmySelect: options.onArmySelect || null,
            render: MapSelection.renderSelection.bind(this),
            clear: MapSelection.clearSelection.bind(this),
        };

        this.factions = {
            config: options.factions || { count: 0 },
            startHops: options.startHops ?? 2,
            capitalPopulation: options.capitalPopulation ?? 120,
            populationDecay: options.populationDecay ?? 0.62,
            colors: { 
                all: [
                    // северная культура (BLUE) — холодные синие/голубые тона
                    { id: 'light-blue', hex: '#7dd3fc', culture: 'BLUE' },
                    { id: 'blue', hex: '#3b82f6', culture: 'BLUE' },
                    { id: 'dark-blue', hex: '#1d4ed8', culture: 'BLUE' },
                    { id: 'steel-blue', hex: '#475569', culture: 'BLUE' },
                
                    // чёрная культура (BLACK) — тёмные, холодные нейтральные
                    { id: 'black', hex: '#18181b', culture: 'BLACK' },
                    { id: 'charcoal', hex: '#3f3f46', culture: 'BLACK' },
                    { id: 'iron', hex: '#52525b', culture: 'BLACK' },
                    { id: 'obsidian', hex: '#27272a', culture: 'BLACK' },
                
                    // южная культура (YELLOW) — тёплые жёлто-оранжевые
                    { id: 'gold', hex: '#f4d03f', culture: 'YELLOW' },
                    { id: 'amber', hex: '#f59e0b', culture: 'YELLOW' },
                    { id: 'orange', hex: '#e67e22', culture: 'YELLOW' },
                
                    // западная культура (GREEN) — зелёные тона
                    { id: 'light-green', hex: '#86efac', culture: 'GREEN' },
                    { id: 'green', hex: '#22c55e', culture: 'GREEN' },
                    { id: 'dark-green', hex: '#166534', culture: 'GREEN' },
                    { id: 'olive', hex: '#65a30d', culture: 'GREEN' },
                
                    // восточная культура (RED) — красные/багровые
                    { id: 'red', hex: '#e63946', culture: 'RED' },
                    { id: 'maroon', hex: '#7f1d1d', culture: 'RED' },
                    { id: 'brick', hex: '#b91c1c', culture: 'RED' },
                
                    // центральная культура (PURPLE) — фиолетовые/розовые
                    { id: 'violet', hex: '#8b5cf6', culture: 'PURPLE' },
                    { id: 'pink', hex: '#ec4899', culture: 'PURPLE' },
                    { id: 'magenta', hex: '#c026d3', culture: 'PURPLE' },
                    { id: 'lavender', hex: '#c4b5fd', culture: 'PURPLE' },

                    // центральная культура (WHITE) — белые
                    { id: 'sand', hex: '#d4a574', culture: 'WHITE' },
                    { id: 'ghost', hex: '#f6f9fe', culture: 'WHITE' },
                    { id: 'grey', hex: '#e2ddda', culture: 'WHITE' },
                    { id: 'white', hex: '#f7f7f7', culture: 'WHITE' }
                ],
                neutral: 'rgba(255, 255, 255, 0)'
            },
            diplomacyColors: {
                player: '#facc15',
                war: '#ef4444',
                alliance: '#3b82f6',
                peace: '#94a3b8',
                neutral: 'rgba(255, 255, 255, 0)',
            },
            getTotal: MapFaction.getTotal.bind(this),
            settle: MapFaction.settle.bind(this),
            drawBorders: MapFaction.drawBorders.bind(this),
            drawBorderEdges: MapFaction.drawBorderEdges.bind(this),
            getFactionAdjacency: MapFaction.getFactionAdjacency.bind(this),
            getNeighboringFactions: MapFaction.getNeighboringFactions.bind(this),
            computeVisibility: MapFaction.computeVisibility.bind(this),
            computeLabelPath: MapFaction.computeLabelPath.bind(this),
            renderFactionLabels: MapFaction.renderFactionLabels.bind(this),
            getLabelPath: MapFaction.getLabelPath.bind(this),
            getFactionFlagImage: MapFaction.getFactionFlagImage.bind(this),
            getFactionFlagKey: MapFaction.getFactionFlagKey.bind(this),
            isDiscovered: MapFaction.isDiscovered.bind(this),
        }

        this.maxFactions = options.maxFactions ?? this.factions.colors.all.length;
        this.factionColorById = Object.fromEntries(this.factions.colors.all.map(c => [c.id, c.hex]));
        this.factionCultureByColorId = Object.fromEntries(this.factions.colors.all.map(c => [c.id, c.culture]));

        this.terrain = {
            config: {
                regionCount: options.regionCount || 3500,
                peakCount: options.peakCount || 4,
                peakShape: options.peakShape || 0.7,
                shapeType: options.shapeType || 'continent',
                landAmount: options.landAmount || 0.8,
                relief: options.relief || 0.9,
                chaos: options.chaos || 0.2,
                edgeRoughness: options.edgeRoughness || 0.32,
                edgeDepth: options.edgeDepth || 3
            },
            regions: {
                all: [],
                render: MapTerrain.renderRegions.bind(this)
            },
            createTemperatures: MapTerrain.createTemperatures.bind(this),
            createRegions: MapTerrain.createRegions.bind(this),
            addBlob: MapTerrain.addBlob.bind(this),
            addRange: MapTerrain.addRange.bind(this),
            spreadDecay: MapTerrain.spreadDecay.bind(this),
            createNeighbors: MapTerrain.createNeighbors.bind(this),
            findNeighbor: MapTerrain.findNeighbor.bind(this),
            getContinentCenters: MapTerrain.getContinentCenters.bind(this),
            createElevation: MapTerrain.createElevation.bind(this),
            classifyByLandFraction: MapTerrain.classifyByLandFraction.bind(this),
            cleanup: MapTerrain.cleanup.bind(this),
        }
        this.utils = {
            strokeOffsetPolyline: MapUtils.strokeOffsetPolyline.bind(this),
            seededRandom: MapUtils.seededRandom.bind(this),
            setSeed: MapUtils.setSeed.bind(this),
            findBand: MapUtils.findBand.bind(this),
            generateRegionName: MapUtils.generateRegionName.bind(this),
            drawCurvedLabel: MapUtils.drawCurvedLabel.bind(this),
            distanceToSegment: MapUtils.distanceToSegment.bind(this),
        }
        this.assets = new AssetManager({
            basePath: options.assetsPath || 'icons/',
            onAnyLoaded: () => { this._invalidateDetailCache(); this.scheduleRender(); },
        });
        this.decorations = {
            enabled: options.iconsEnabled ?? true,
            ready: false,
            edgeMargin: options.iconEdgeMargin ?? 1.2,
            defaultSizePct: options.iconDefaultSizePct || [0.5, 0.6],
            townExclusionRadius: options.townExclusionRadius ?? 8,
            riverExclusionRadius: options.riverExclusionRadius ?? 3, 
            gapFactor: options.iconGapFactor ?? 0.7, 
            sets: {
                STEPPE:       { count: [20, 40], keys: ['grass_tuft'], sizePct: [0.15, 0.18] },
                PLAINS:       { count: [20, 40], keys: ['grass_tuft'], sizePct: [0.15, 0.18] },
                GRASSLAND:    { count: [20, 40], keys: ['grass_tuft'], sizePct: [0.15, 0.18] },
                WETLANDS:     { count: [20, 40], keys: ['grass_tuft','reed'], sizePct: [0.15, 0.18] },
                WOODLAND:     { count: [20, 140], keys: ['grass_tuft','tree_lone'], sizePct: [0.15, 0.18] },
                DENSE_FOREST: { count: [20, 140], keys: ['grass_tuft','tree_lone'], sizePct: [0.15, 0.18] },
                FOREST:       { count: [20, 140], keys: ['grass_tuft','tree_lone'], sizePct: [0.15, 0.18] },
                HIGHLANDS:    { count: [10, 20], keys: ['grass_tuft','rock','tree_lone'], sizePct: [0.5, 0.55] },
                PEAKS:        { count: [10, 20], keys: ['grass_tuft','mountain','tree_lone'], sizePct: [0.5, 0.55]  },
                COAST:        { count: [10, 20], keys: ['grass_tuft'], sizePct: [0.15, 0.18] },
            },
            snowSets: {
                FOREST:       { count: [20, 40], keys: ['grass_tuft','tree_snow'], sizePct: [0.15, 0.18]  },
                DENSE_FOREST: { count: [20, 40], keys: ['grass_tuft','tree_snow'], sizePct: [0.15, 0.18]  },
                WOODLAND:     { count: [20, 40], keys: ['grass_tuft','tree_snow'], sizePct: [0.15, 0.18]  },
                PEAKS:        { count: [10, 20], keys: ['grass_tuft','mountain_snow'], sizePct: [0.5, 0.55]  },
                HIGHLANDS:    { count: [10, 20], keys: ['grass_tuft','mountain_snow'], sizePct: [0.5, 0.55] },
            },
            hotSets: {
                COAST:        { count: [10, 20], keys: ['sand'], sizePct: [0.5, 0.6] },
                STEPPE:       { count: [10, 20], keys: ['sand'], sizePct: [0.65, 0.8] },
                PLAINS:       { count: [10, 20], keys: ['sand'], sizePct: [0.65, 0.8] },
                GRASSLAND:    { count: [10, 20], keys: ['palm_lone'], sizePct: [0.15, 0.18] },
                FOREST:       { count: [20, 40], keys: ['palm_cluster'], sizePct: [0.15, 0.18]  },
                DENSE_FOREST: { count: [20, 40], keys: ['palm_cluster'], sizePct: [0.15, 0.18]  },
                WOODLAND:     { count: [20, 40], keys: ['palm_lone'], sizePct: [0.15, 0.18]  },
                WETLANDS:     { count: [10, 20], keys: ['palm_lone'], sizePct: [0.15, 0.18] },
            },
            waterSets: {
                DEEP_OCEAN:   { count: [10, 20], keys: ['wave'], sizePct: [0.5, 0.6] },
                OCEAN:        { count: [10, 20], keys: ['wave'], sizePct: [0.5, 0.6] },
                SHALLOW:      { count: [10, 20], keys: ['wave'], sizePct: [0.5, 0.6] },
            },
            variantsPerKey: {
                grass_tuft: 3, tree_lone: 3, tree_cluster: 3, tree_snow: 3,  tree_snow_cluster: 3,
                reed: 1, rock: 3, mountain: 3, mountain_snow: 2, wave: 3, sand: 3,
                palm_lone: 3, palm_cluster: 3, cactus: 1, oasis: 2, red_dot: 1
            },
            biomeAffinity: {
                FOREST: { FOREST: 1.0, DENSE_FOREST: 0.0, WOODLAND: 0.0 },
                DENSE_FOREST: { DENSE_FOREST: 1.0, FOREST: 0.0, WOODLAND: 0.0 },
                WOODLAND: { WOODLAND: 1.0, FOREST: 0.0, DENSE_FOREST: 0.0 },
                HIGHLANDS: { HIGHLANDS: 1.0, PEAKS: 0.0 },
                PEAKS: { PEAKS: 1.0, HIGHLANDS: 0.9 },
            },
            textures: {
                variantCount: 1,
                alpha: options.textureAlpha ?? 0.6,
            },
            loadAssets: MapDecorations.loadAssets.bind(this),
            shrinkPolygon: MapDecorations.shrinkPolygon.bind(this),
            pointInPolygon: MapDecorations.pointInPolygon.bind(this),
            resolveIconSet: MapDecorations.resolveIconSet.bind(this),
            generatePlacements: MapDecorations.generatePlacements.bind(this),
            assignTo: MapDecorations.assignTo.bind(this),
            paint: MapDecorations.paint.bind(this),
            paintTextures: MapDecorations.paintTextures.bind(this),
            computeBias: MapDecorations.computeBias.bind(this),
        };

        this.pixelDecor = {
            cellWorld: options.pixelCell ?? 0.4, cache: new Map(), cacheSeason: null,
            ...MapPixelDecor.data,
            ...Object.fromEntries(Object.entries(MapPixelDecor.methods).map(([k, f]) => [k, f.bind(this)])),
        };

        this.rivers = {
            enabled: options.riversEnabled ?? true,
            ready: false,
            segments: [],
            count: options.riverCount ?? 36,
            minPoints: options.riverMinPoints ?? 6,
            maxPoints: options.riverMaxPoints ?? 20,       
            minSourceLandDistance: options.riverMinSourceLandDistance ?? 1, // насколько глубоко в сушу должен быть исток
            branchChance: options.riverBranchChance ?? 0.35,
            branchMinLength: options.riverBranchMinLength ?? 6, 
            widthMin: options.riverWidthMin ?? 0.4,
            widthMax: options.riverWidthMax ?? 0.9,
            color: options.riverColor ?? '#395463',
            bridges: [], 
            bridgeChance: options.riverBridgeChance ?? 0.3,
            bridgeMinGap: options.riverBridgeMinGap ?? 2, 
            bridgeLength: options.riverBridgeLength ?? 2.5, 
            bridgeWidth: options.riverBridgeWidth ?? 1.2,
            blockedPairs: new Set(), 
            buildVertexGraph: MapRivers.buildVertexGraph.bind(this),
            annotateVertices: MapRivers.annotateVertices.bind(this),
            findMouthCandidates: MapRivers.findMouthCandidates.bind(this),
            findSourceCandidates: MapRivers.findSourceCandidates.bind(this),
            tracePath: MapRivers.tracePath.bind(this),
            _findNextConfluence: MapRivers._findNextConfluence.bind(this),
            generate: MapRivers.generate.bind(this),
            createPolylines: MapRivers.createPolylines.bind(this),
            paint: MapRivers.paint.bind(this),
            paintBridges: MapRivers.paintBridges.bind(this),
            isBlocking: MapRivers.isBlocking.bind(this),
            hasBridge: MapRivers.hasBridge.bind(this),
            createProximityIndex: MapRivers.createProximityIndex.bind(this),
        };

        this.armies = {
            movementCost: {
                STEPPE: 1, PLAINS: 1, GRASSLAND: 1, COAST: 1,
                WETLANDS: 1.5,
                WOODLAND: 1.5, FOREST: 2, DENSE_FOREST: 2.5,
                HIGHLANDS: 2.5, PEAKS: 3.5,
            },
            animations: {
                all: new Map(),
                duration: options.armyAnimDuration ?? 400,
                move: MapArmies.moveAnimation.bind(this),
                runLoop: MapArmies.runAnimationLoop.bind(this),
            },
            assets: {
                get: MapArmies.getArmyAsset.bind(this),
                buildKey: MapArmies.buildArmyAssetKey.bind(this),
                ranks: options.armyRanks ?? 5,
                variantsPerRank: options.armyVariantsPerRank ?? 3,
            },
            computeReachable: MapArmies.computeReachable.bind(this),
            select: MapArmies.select.bind(this),
            render: MapArmies.render.bind(this),
            renderReachableArea: MapArmies.renderReachableArea.bind(this),
            renderOccupationHatching: MapArmies.renderOccupationHatching.bind(this),
        }

        this.cultures = {
            all: [
                { id: 'BLUE', label: 'Лазурные', icon: '🔵', color: '#3b82f6' },
                { id: 'RED', label: 'Багровые', icon: '🔴', color: '#ef4444' },
                { id: 'YELLOW', label: 'Златые', icon: '🟡', color: '#eab308' },
                { id: 'BLACK', label: 'Чёрные', icon: '⚫', color: '#1e1b1e' },
                { id: 'GREEN', label: 'Изумрудные', icon: '🟢', color: '#22c55e' },
                { id: 'PURPLE', label: 'Пурпурные', icon: '🟣', color: '#a855f7' },
                { id: 'WHITE', label: 'Белые', icon: '⚪', color: '#ffffff' },
            ],
            create: MapCultures.create.bind(this),
            createPoles: MapCultures.createPoles.bind(this),
            applyAssimilation: MapCultures.applyAssimilation.bind(this),
            getDominantOfRegion: MapCultures.getDominantOfRegion.bind(this)
        }
        this.cultureIds = this.cultures.all.map(c => c.id);
        this.cultureLabelById = Object.fromEntries(this.cultures.all.map(c => [c.id, c.label]));
        this.cultureColorById = Object.fromEntries(this.cultures.all.map(c => [c.id, c.color]));
        this.cultureClusterSharpness = options.cultureClusterSharpness ?? 4; 
        this.cultureIconById = Object.fromEntries(this.cultures.all.map(c => [c.id, c.icon]));

        this.towns = {
            resourceBonus: options.townResourceBonus ?? { food: 1.25, production: 1.25, gold: 1.4 },
            chance: options.townChance ?? 0.06,
            assets: {
                ready: false,
                images: {},
                variantsPerKey: options.townVariantsPerKey ?? 3,
                keysByBiome: options.townKeysByBiome || {
                    COAST: 'town_coast', STEPPE: 'town_plains', PLAINS: 'town_plains', GRASSLAND: 'town_plains',
                    WETLANDS: 'town_wetlands', WOODLAND: 'town_forest', FOREST: 'town_forest', DENSE_FOREST: 'town_forest',
                    HIGHLANDS: 'town_hills', PEAKS: 'town_mountain',
                },
                keysByBiomeSnow: options.townKeysByBiomeSnow || {
                    WOODLAND: 'town_forest_snow', FOREST: 'town_forest_snow', DENSE_FOREST: 'town_forest_snow',
                    PEAKS: 'town_mountain_snow', HIGHLANDS: 'town_hills_snow',
                },
                keysByBiomeHot: options.townKeysByBiomeHot || {
                    STEPPE: 'town_desert', PLAINS: 'town_desert', COAST: 'town_desert_coast',
                },
            },
            loadAssets: MapTowns.loadAssets.bind(this),
            buildKey: MapTowns.buildKey.bind(this),
            render: MapTowns.render.bind(this)
        }

        this.perf = {
            enabled: options.perfEnabled ?? true,
            frameTimes: [], // скользящее окно длительностей кадров, для FPS
            frameWindow: 60,
            lastFrameStart: null,
            marks: {}, 
            lastStageTimings: {},
            overlay: null,
            frameStart: MapPerf.frameStart.bind(this),
            markStart: MapPerf.markStart.bind(this),
            markEnd: MapPerf.markEnd.bind(this),
            getStats: MapPerf.getStats.bind(this),
            initOverlay: MapPerf.initOverlay.bind(this),
            updateOverlay: MapPerf.updateOverlay.bind(this),
        };

        if (this.perf.enabled) this.perf.initOverlay();
        if (this.decorations.enabled) this.decorations.loadAssets();
        this.towns.loadAssets();

        this._initConfig();

        if (this.canvas) {
            this.interaction.initEvents();
        }
    }

    // ═══════════════════════════════════════════════════════════
    // SECTION: MAP_CONFIG
    // Статичная конфигурация — биомы, сезоны, палитра фракций.
    // Вычисляется один раз в конструкторе, не меняется в рантайме.
    // ═══════════════════════════════════════════════════════════
    _initConfig() {
        this.biomeDefs = [
            { id: 'DEEP_OCEAN', isWater: true, maxT: 0.45, label: 'Глубокий океан',
              color: '#2E444F', resources: { food: 0, production: 0, manpower: 0, gold: 0, ether: 0, upkeep: -0.2 } },
            { id: 'OCEAN', isWater: true, maxT: 0.80, label: 'Океан',
              color: '#344C59', resources: { food: 1, production: 0, manpower: 0, gold: 1, ether: 0, upkeep: -0.3 } },
            { id: 'SHALLOW', isWater: true, maxT: Infinity, label: 'Мелководье',
              color: '#395463', resources: { food: 2, production: 0, manpower: 0, gold: 0, ether: 0, upkeep: -0.3 } },

            { id: 'COAST', isWater: false, maxT: 0.08, label: 'Побережье',
            colors: { cold: '#A6AD84', temperate: '#A1AD62', hot: '#CCC08D' },
            resources: { food: 2, production: 1, manpower: 1, gold: 1, ether: 0, upkeep: -0.5 } },
            
            { id: 'STEPPE_ETHER', isWater: false, maxT: 0.09, label: 'Эфирный разлом (Побережье)',
            colors: { cold: '#A6AD84', temperate: '#A1AD62', hot: '#CCC08D' },
            resources: { food: 2, production: 1, manpower: 1, gold: 1, ether: 3, upkeep: -0.5 } },
            
            { id: 'STEPPE', isWater: false, maxT: 0.16, label: 'Степь',
            colors: { cold: '#9AA179', temperate: '#929E53', hot: '#C2B57A' },
            resources: { food: 1, production: 1, manpower: 2, gold: 0, ether: 0, upkeep: -0.5 } },
            
            { id: 'STEPPE_ETHER', isWater: false, maxT: 0.17, label: 'Эфирный разлом',
            colors: { cold: '#9AA179', temperate: '#929E53', hot: '#C2B57A' },
            resources: { food: 1, production: 1, manpower: 2, gold: 0, ether: 3, upkeep: -0.5 } },
            
            { id: 'PLAINS', isWater: false, maxT: 0.25, label: 'Равнина',
            colors: { cold: '#9AA179', temperate: '#929E53', hot: '#C2B57A' },
            resources: { food: 3, production: 1, manpower: 1, gold: 0, ether: 0, upkeep: -0.6 } },
            
            { id: 'PLAINS_ETHER', isWater: false, maxT: 0.26, label: 'Эфирный разлом (Равнина)',
            colors: { cold: '#9AA179', temperate: '#929E53', hot: '#C2B57A' },
            resources: { food: 1, production: 1, manpower: 2, gold: 0, ether: 3, upkeep: -0.5 } },
            
            { id: 'GRASSLAND', isWater: false, maxT: 0.35, label: 'Луга',
            colors: { cold: '#9AA179', temperate: '#929E53', hot: '#C2B57A' },
            resources: { food: 3, production: 1, manpower: 2, gold: 0, ether: 0, upkeep: -0.6 } },
            
            { id: 'WETLANDS', isWater: false, maxT: 0.45, label: 'Болота',
            colors: { cold: '#9AA179', temperate: '#929E53', hot: '#C2B57A' },
            resources: { food: 2, production: 0, manpower: 1, gold: 0, ether: 0, upkeep: -0.7 } },
            
            { id: 'WOODLAND', isWater: false, maxT: 0.56, label: 'Редколесье',
            colors: { cold: '#9AA179', temperate: '#929E53', hot: '#C2B57A' },
            resources: { food: 1, production: 2, manpower: 1, gold: 0, ether: 0, upkeep: -0.6 } },

            { id: 'WOODLAND_ETHER', isWater: false, maxT: 0.57, label: 'Эфирный разлом (Редколесье)',
            colors: { cold: '#9AA179', temperate: '#929E53', hot: '#C2B57A' },
            resources: { food: 1, production: 1, manpower: 2, gold: 0, ether: 3, upkeep: -0.5 } },

            { id: 'FOREST', isWater: false, maxT: 0.68, label: 'Лес',
            colors: { cold: '#9AA179', temperate: '#929E53', hot: '#C2B57A' },
            resources: { food: 1, production: 3, manpower: 1, gold: 0, ether: 0, upkeep: -0.7 } },

            { id: 'DENSE_FOREST', isWater: false, maxT: 0.80, label: 'Густой лес',
            colors: { cold: '#9AA179', temperate: '#929E53', hot: '#C2B57A' },
            resources: { food: 0, production: 3, manpower: 1, gold: 0, ether: 0, upkeep: -0.8 } },

            { id: 'HIGHLANDS', isWater: false, maxT: 0.92, label: 'Плоскогорье',
            colors: { cold: '#9AA179', temperate: '#929E53', hot: '#C2B57A' },
            resources: { food: 0, production: 2, manpower: -1, gold: 2, ether: 0, upkeep: -0.9 } },

            { id: 'PEAKS', isWater: false, maxT: Infinity, label: 'Пик',
            colors: { cold: '#9AA179', temperate: '#929E53', hot: '#C2B57A' },
            resources: { food: 0, production: 1, manpower: -2, gold: 3, ether: 0, upkeep: -1.0 } }
        ];

        this.waterBiomes = this.biomeDefs.filter(b => b.isWater);
        this.landElevationBands = this.biomeDefs.filter(b => !b.isWater);

        this.biomesMap = {};
        this.elevationBandLabels = {};
        this.biomeResourceBase = {};

        this.biomeDefs.forEach(b => {
            this.elevationBandLabels[b.id] = b.label;
            this.biomeResourceBase[b.id] = b.resources;
            if (b.isWater) {
                this.biomesMap[b.id] = b.color;
            } else {
                ['cold', 'temperate', 'hot'].forEach(zone => {
                    this.biomesMap[b.id + '_' + zone] = b.colors[zone];
                });
            }
        });

        this.cityResourceBonus = { production: 1, manpower: 1, ether: 1, gold: 1, upkeep: -0.5 };
        this.climateZoneLabels = { cold: 'холодный', temperate: 'умеренный', hot: 'жаркий' };

        this.seasons = {
            SPRING: {
                label: 'Весна',
                modifiers: {
                    cold:      { food: 0.9, production: 1.0, ether: 1.0, manpower: 1.0, gold: 1.0, upkeep: 1.0 },
                    temperate: { food: 1.1, production: 1.0, ether: 1.0, manpower: 1.0, gold: 1.0, upkeep: 1.0 },
                    hot:       { food: 1.0, production: 1.0, ether: 1.0, manpower: 1.0, gold: 1.0, upkeep: 1.0 },
                },
                tints: {
                    land:  { cold: { color: '#dfeff5', strength: 0.3 }, temperate: { color: '#d9f2a3', strength: 0.15 }, hot: { color: '#f2e6a8', strength: 0.05 } },
                    water: { cold: { color: '#dfeff5', strength: 0.01 }, temperate: { color: '#dfeff5', strength: 0.00 }, hot: { color: '#dfeff5', strength: 0.00 } },
                },
            },
            SUMMER: {
                label: 'Лето',
                modifiers: {
                    cold:      { food: 1.1, production: 1.1, ether: 1.0, manpower: 1.1, gold: 1.0, upkeep: 1.0 },
                    temperate: { food: 1.3, production: 1.1, ether: 1.0, manpower: 1.1, gold: 1.0, upkeep: 1.0 },
                    hot:       { food: 0.8, production: 0.9, ether: 1.0, manpower: 0.9, gold: 1.1, upkeep: 1.1 },
                },
                tints: {
                    land:  { cold: { color: '#ffffff', strength: 0.05 }, temperate: { color: '#fff4b0', strength: 0.05 }, hot: { color: '#ffdd88', strength: 0.18 } },
                    water: { cold: { color: '#bfe0e8', strength: 0.00 }, temperate: { color: '#bfe0e8', strength: 0.00 }, hot: { color: '#bfe0e8', strength: 0.00 } },
                },
            },
            AUTUMN: {
                label: 'Осень',
                modifiers: {
                    cold:      { food: 0.8, production: 1.0, ether: 1.0, manpower: 0.9, gold: 1.0, upkeep: 1.0 },
                    temperate: { food: 1.2, production: 1.0, ether: 1.0, manpower: 1.0, gold: 1.0, upkeep: 1.0 },
                    hot:       { food: 1.0, production: 1.0, ether: 1.0, manpower: 1.0, gold: 1.0, upkeep: 1.0 },
                },
                tints: {
                    land:  { cold: { color: '#ffffff', strength: 0.30 }, temperate: { color: '#d9822b', strength: 0.25 }, hot: { color: '#e0a83e', strength: 0.08 } },
                    water: { cold: { color: '#7a8fa0', strength: 0.05 }, temperate: { color: '#7a8fa0', strength: 0.05 }, hot: { color: '#7a8fa0', strength: 0.00 } },
                },
            },
            WINTER: {
                label: 'Зима',
                modifiers: {
                    cold:      { food: 0.3, production: 0.7, ether: 1.0, manpower: 0.7, gold: 0.9, upkeep: 1.3 },
                    temperate: { food: 0.6, production: 0.9, ether: 1.0, manpower: 0.9, gold: 1.0, upkeep: 1.15 },
                    hot:       { food: 0.9, production: 1.0, ether: 1.0, manpower: 1.0, gold: 1.0, upkeep: 1.0 },
                },
                tints: {
                    land:  { cold: { color: '#ffffff', strength: 0.80 }, temperate: { color: '#ffffff', strength: 0.35 }, hot: { color: '#ffffff', strength: 0.00 } },
                    water: { cold: { color: '#e8f4fb', strength: 0.02 }, temperate: { color: '#e8f4fb', strength: 0.01 }, hot: { color: '#e8f4fb', strength: 0.00 } },
                },
            },
        };
        this.seasonOrder = Object.keys(this.seasons);
        this.specializationDefs = [
            { id: 'NONE', label: 'Нет', modifiers: {} },
            { id: 'AGRICULTURE', label: 'Сельское хозяйство', modifiers: { food: 1.5, production: 0.8 } },
            { id: 'INDUSTRY', label: 'Промышленность', modifiers: { production: 1.5, food: 0.8 } },
            { id: 'TRADE', label: 'Торговля', modifiers: { gold: 1.5, production: 0.8, food: 0.8 } },
        ];
        
        this.specializationsMap = {};
        this.specializationDefs.forEach(s => { this.specializationsMap[s.id] = s; });
    }
    // ═══════════════════════════════════════════════════════════
    // SECTION: MAP_GEOMETRY
    // Полигональная геометрия: шумные края, path региона,
    // граф рёбер (для границ). Чистая математика над Voronoi.
    // ═══════════════════════════════════════════════════════════

    getNoisyLineSegments(x0, y0, x1, y1) {
        const key = `${Math.round(x0*10)},${Math.round(y0*10)}-${Math.round(x1*10)},${Math.round(y1*10)}`;
        const revKey = `${Math.round(x1*10)},${Math.round(y1*10)}-${Math.round(x0*10)},${Math.round(y0*10)}`;

        if (this.noisyEdgeCache.has(key)) return this.noisyEdgeCache.get(key);
        if (this.noisyEdgeCache.has(revKey)) return [...this.noisyEdgeCache.get(revKey)].reverse();

        let points = [{x: x0, y: y0}, {x: x1, y: y1}];
        for (let i = 0; i < this.terrain.config.edgeDepth; i++) {
            const nextPoints = [];
            for (let j = 0; j < points.length - 1; j++) {
                const p0 = points[j], p1 = points[j + 1];
                nextPoints.push(p0);

                const mx = (p0.x + p1.x) * 0.5;
                const my = (p0.y + p1.y) * 0.5;
                const dx = p1.x - p0.x, dy = p1.y - p0.y;
                const length = Math.hypot(dx, dy);

                const offset = (this.utils.seededRandom() - 0.5) * length * this.terrain.config.edgeRoughness;
                const nx = -dy / length * offset;
                const ny = dx / length * offset;

                nextPoints.push({ x: mx + nx, y: my + ny });
            }
            nextPoints.push(points[points.length - 1]);
            points = nextPoints;
        }

        this.noisyEdgeCache.set(key, points);
        return points;
    }

    drawRegionPath(ctx, polygon) {
        ctx.beginPath();
        let firstPoint = true;
        for (let j = 0; j < polygon.length - 1; j++) {
            const p1 = polygon[j], p2 = polygon[j + 1];
            const noisySegment = this.getNoisyLineSegments(p1[0], p1[1], p2[0], p2[1]);
            for (let k = 0; k < noisySegment.length; k++) {
                const pt = noisySegment[k];
                if (firstPoint) { ctx.moveTo(pt.x, pt.y); firstPoint = false; }
                else { ctx.lineTo(pt.x, pt.y); }
            }
        }
        ctx.closePath();
    }
    createEdgeMap() {
        const edgeMap = new Map();
        function edgeKey(p1, p2) {
            const a = `${Math.round(p1[0] * 10)},${Math.round(p1[1] * 10)}`;
            const b = `${Math.round(p2[0] * 10)},${Math.round(p2[1] * 10)}`;
            return a < b ? `${a}|${b}` : `${b}|${a}`;
        }
        for (let i = 0; i < this.terrain.regions.all.length; i++) {
            const polygon = this.mapVoronoi.cellPolygon(i);
            if (!polygon) continue;
            for (let j = 0; j < polygon.length - 1; j++) {
                const p1 = polygon[j], p2 = polygon[j + 1];
                const key = edgeKey(p1, p2);
                if (!edgeMap.has(key)) edgeMap.set(key, { regionIds: [], p1, p2 });
                edgeMap.get(key).regionIds.push(i);
            }
        }
        return edgeMap;
    }
    computeDistanceToWater(regions, neighborsList) {
        const n = regions.length;
        const dist = new Int16Array(n).fill(-1);
        let frontier = [];
        regions.forEach((r, i) => { if (r.isWater) { dist[i] = 0; frontier.push(i); } });
    
        let hop = 0;
        while (frontier.length) {
            hop++;
            const next = [];
            frontier.forEach(id => {
                (neighborsList[id] || []).forEach(nb => {
                    if (dist[nb] === -1) { dist[nb] = hop; next.push(nb); }
                });
            });
            frontier = next;
        }
        return dist;
    }

    
    // ═══════════════════════════════════════════════════════════
    // SECTION: MAP_DATA
    // Динамический синтез: превращает статичные mapRegions + текущие
    // "живые" параметры (сезон) в данные наружу и в тултип.
    // Вызывается многократно, без пересчёта setup().
    // ═══════════════════════════════════════════════════════════

    getRegionData(region) {
        return {
            id: region.id,
            name: region.name,
            x: region.x,
            y: region.y,
            isWater: region.isWater,
            biome: region.biomeBand,
            climateZone: region.climateZone,
            city: region.city,
            ownerId: region.ownerId,
            culture: region.culture,
            population: region.population,
            resources: this.getRegionResources(region),
            specialization: region.specialization,
            pendingSpecialization: region.pendingSpecialization
        };
    }
    
    getRegionsData() {
        return this.terrain.regions.all.map(region => this.getRegionData(region));
    }

    getFactionsData() {
        return this.factions.list || [];
    }
    getRegionResources(region, season = this.currentSeason) {
        const base = this.biomeResourceBase[region.biomeBand ?? region.biome];
        if (!base) return null;
    
        const zone = region.climateZone || 'temperate';
        const mod = this.seasons[season].modifiers[zone];
        const specMod = this.specializationsMap[region.specialization]?.modifiers || {};
        const townMod = region.isTown ? this.towns.resourceBonus : {};
        const loyaltyMod = this.getLoyaltyModifier(this.getRegionLoyalty(region));
    
        const result = {};
        for (const key of Object.keys(base)) {
            let value = base[key] * (mod[key] ?? 1);
            if (key !== 'upkeep') {
                value *= (specMod[key] ?? 1);
                value *= (townMod[key] ?? 1);
                value *= loyaltyMod; // ← новое, применяется ко всем ресурсам, кроме upkeep
            }
            result[key] = key === 'upkeep' ? -Math.abs(value) : value;
        }
        if (region.city) {
            for (const key of Object.keys(this.cityResourceBonus)) {
                result[key] = (result[key] || 0) + this.cityResourceBonus[key];
            }
        }
        return result;
    }
    getRegionResourcesForecast(region, season = this.currentSeason) {
        
        if (!region?.pendingSpecialization) {
            return this.getRegionResources(region, season); // нет изменений в очереди — прогноз совпадает с текущим
        }
    
        const actualSpec = region.specialization;
        region.specialization = region.pendingSpecialization;
        const forecast = this.getRegionResources(region, season);
        region.specialization = actualSpec;
        return forecast;
    }
    getFactionEconomy(factionId) {
        const totals = { food: 0, production: 0, manpower: 0, gold: 0, ether: 0, upkeep: 0 };
        let regionCount = 0;
    
        this.terrain.regions.all.forEach(region => {
            if (region.ownerId !== factionId) return;
            const res = this.getRegionResources(region);
            if (!res) return;
            regionCount++;
            totals.food += res.food;
            totals.production += res.production;
            totals.ether += res.ether;
            totals.manpower += res.manpower;
            totals.gold += res.gold;
            totals.upkeep += res.upkeep;
        });
    
        return { ...totals, regionCount };
    }
    getFactionEconomyForecast(factionId) {
        const totals = { food: 0, production: 0, manpower: 0, gold: 0, ether: 0, upkeep: 0 };
    
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
    getRegionLoyalty(region) {
        if (region.ownerId === null || region.ownerId === undefined || !region.culture) return 1; // нейтралы — нейтральная лояльность
        const faction = this.factions.list?.[region.ownerId];
        if (!faction || !faction.culture) return 1;
        return region.culture[faction.culture] ?? 0; // доля 0..1 — это и есть "лояльность" по вашему описанию
    }
    
    getLoyaltyModifier(loyalty) {
        // линейная шкала: 0% culture-match -> 0.6x ресурсов, 100% -> 1.2x, с изгибом вокруг разумной середины
        return 0.6 + loyalty * 0.6;
    }
    getAllFactionEconomies() {
        const result = {};
        (this.factions.list || []).forEach(f => {
            result[f.id] = this.getFactionEconomy(f.id);
        });
        return result;
    }
    getSelectedRegion() {
        if (this.selection.regionId === null) return null;
        const region = this.terrain.regions.all[this.selection.regionId];
        return region ? this.getRegionData(region) : null;
    }
    setViewMode(mode) {
        this.viewMode = mode;
        this.markDirty('terrain', 'political');
        this._invalidateDetailCache(); 
        this.render();
    }
    setSeason(season){
        this.currentSeason = season
        this.markDirty('terrain');
        this.render()
    }
    setShowClimate(climate){
        this.showClimate = climate
        this.markDirty('terrain');
        this.render()
    }
    setDiplomaticColorResolver(fn) {
        this.factions.getDiplomaticColor = fn;
    }
    setPlayerFaction(factionId) {
        this.playerFactionId = factionId;
        this._invalidateVisibilityCache();
        this._invalidateDetailCache();
        this.updateExploredRegions();
        this.markDirty('fog');
        this.render();
    }
    setArmiesProvider(fn) {
        this.armiesProvider = fn;
    }
    setRegionSpecialization(regionId, specializationId) {
        if (!this.specializationsMap[specializationId]) return false;
        const region = this.terrain.regions.all[regionId];
        if (!region || region.isWater) return false;
    
        region.pendingSpecialization = specializationId;
        return true;
    }
    applyPendingSpecializations() {
        this.terrain.regions.all.forEach(region => {
            if (region.pendingSpecialization !== null) {
                region.specialization = region.pendingSpecialization;
                region.pendingSpecialization = null;
            }
        });
    }
    updateExploredRegions() {
        if (!this.fogEnabled || this.playerFactionId === null || this.playerFactionId === undefined) return;
        const visible = this.getCachedVisibility();
        if (!visible) return;
        for (let i = 0; i < visible.length; i++) {
            if (visible[i]) this.exploredRegions.add(i);
        }
    }
    // ═══════════════════════════════════════════════════════════
    // SECTION: MAP_SETUP
    // Точка входа первичного этапа: собирает terrain + факции
    // в this.terrain.regions.all, кэширует edgeMap. create() — публичная
    // обёртка, которая сразу же вызывает первый render() и отдаёт
    // наружу данные для дальнейшей динамической синхронизации.
    // ═══════════════════════════════════════════════════════════
    async shake(){
        for(var i = 0; i < 400; i++){
            setTimeout(() => {
                this.scheduleRender();
                if(i == 399) return;
            }, 10*i);
        }
    }
    create(seed) {
        this.setup(seed);
        this.markDirty('terrain', 'political');
        this.render();
        //this.shake();
        return {
            regions: this.getRegionsData(),
            factions: this.getFactionsData(),
        };
    }

    setup(seed) {
        if (seed !== undefined) this.utils.setSeed(seed);
        else this.currentSeed = this.initialSeed;

        this.noisyEdgeCache.clear();
        
        const regions = this.terrain.createRegions(this.width, this.height, 10).map((s, i) => ({
            id: i, x: s.x, y: s.y, elevation: 0, t: 0, biome: 'OCEAN', biomeBand: 'OCEAN',
            biomeClimate: 'OCEAN', biomeNeutral: 'OCEAN', climateZone: null, isWater: true, city: null,
            ownerId: null,
            occupiedBy: null,
            specialization: 'NONE',
            pendingSpecialization: null,
        }));

        const points = new Float64Array(regions.length * 2);
        for (let i = 0; i < regions.length; i++) {
            points[i * 2] = regions[i].x;
            points[i * 2 + 1] = regions[i].y;
        }
        const delaunay = new d3.Delaunay(points);
        const voronoi = delaunay.voronoi([0, 0, this.width, this.height]);
        
        const neighbors = this.terrain.createNeighbors(delaunay, regions.length);

        const elevation = this.terrain.createElevation(regions, neighbors);

        const targetFraction = Math.min(0.62, Math.max(0.12, 0.20 + (this.terrain.config.landAmount - 0.5) * 0.35));
        const { isWater, t } = this.terrain.classifyByLandFraction(elevation, targetFraction);

        const minLandSize = Math.max(4, Math.round(this.terrain.config.regionCount * 0.006));
        this.terrain.cleanup(isWater, neighbors, minLandSize);

        const temperature = this.terrain.createTemperatures(regions, t);
        const culturePoles = this.cultures.createPoles();
        regions.forEach((region, i) => {
            region.elevation = elevation[i];
            region.t = t[i];
            region.isWater = !!isWater[i];
            region.isTown = false;
            region.temperature = temperature[i];
            region.name = this.utils.generateRegionName(region.isWater);
            const zone = temperature[i] < 0.20 ? 'cold' : temperature[i] > 0.60 ? 'hot' : 'temperate';
            region.climateZone = zone;
            if (region.isWater) {
                const id = this.utils.findBand(this.waterBiomes, t[i]).id;
                region.biomeBand = id;
                region.biomeClimate = id;
                region.biomeNeutral = id;
                region.culture = null; 
            } else {
                const band = this.utils.findBand(this.landElevationBands, t[i]);
                region.biomeBand = band.id;
                region.biomeClimate = band.id + '_' + zone;
                region.biomeNeutral = band.id + '_temperate';
                region.culture = this.cultures.create(region, culturePoles);
            }
            region.decorBias = this.decorations.computeBias(region, regions, neighbors);
        });

        this.factions.settle(regions, neighbors);

        (this.factions.list || []).forEach(faction => {
            const capital = regions[faction.capitalRegionId];
            if (capital) capital.isTown = true;
        });

        regions.forEach(region => {
            if (region.isWater || region.isTown) return;
            if (this.utils.seededRandom() < this.towns.chance) region.isTown = true;
        });

        const distanceToWater = this.computeDistanceToWater(regions, neighbors);

        regions.forEach((region, i) => {
            const polygon = voronoi.cellPolygon(i);
            if (polygon) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const [x, y] of polygon) {
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                }
                region.bbox = { minX, minY, maxX, maxY };
                region.labelPath = this.computeRegionLabelPath(region, polygon);
            } else {
                region.bbox = { minX: region.x, minY: region.y, maxX: region.x, maxY: region.y };
            }
            this.decorations.assignTo(region, polygon || []);
            region.distanceToWater = distanceToWater[i];
        });
        
        this.vertexGraph = this.rivers.buildVertexGraph(regions, voronoi);
        this.rivers.annotateVertices(this.vertexGraph, regions);

        regions.forEach(region => {
            if (region.isTown) {
                const baseKey = this.towns.buildKey(region);
                const variant = 1 + Math.floor(this.utils.seededRandom() * this.towns.assets.variantsPerKey);
                region.townAssetKey = `${baseKey}_${variant}`;
            }
        });

        this.factions.labelPathCache = new Map();

        this.terrain.regions.all = regions;
        this.mapVoronoi = voronoi;
        this.edgeMap = this.createEdgeMap();
        this.regionNeighbors = neighbors;
        this.rivers.generate(regions, neighbors);
        this.riverProximityIndex = this.rivers.createProximityIndex();

        this.viewTransform = { x: 0, y: 0, scale: 1 };
    }
    // ═══════════════════════════════════════════════════════════
    // SECTION: MAP_RENDER
    // Второй этап: перекладывает уже готовые this.terrain.regions.all на canvas.
    // Ничего не мутирует в данных — вызывается на каждую смену
    // сезона/слоя/фильтра без повторного setup().
    // ═══════════════════════════════════════════════════════════
    render() {
        this.perf.frameStart();
        this._currentVisibleRect = this.getVisibleWorldRect(); // считаем один раз за кадр
        this.updateViewLevel(this._currentVisibleRect);
    
        if (this.viewLevel === 'detail') this._drawDetail(this._currentVisibleRect);
        else if (this.viewLevel === 'overview') this._drawOverview();
        else this._drawGlobal();
    
        this.perf.updateOverlay();
    }
    _blitStaticLayers() {
        this.repaintLayersIfDirty();
    
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();

        const src = this._compositeBitmap || this._composite;
        if (!src) return;
        const s = this.viewTransform.scale / this.mapLayerScale;
        this.ctx.save();
        this.ctx.translate(this.viewTransform.x, this.viewTransform.y);
        this.ctx.scale(s, s);
        this.ctx.drawImage(src, 0, 0);
        this.ctx.restore();
    }
    _drawOverview() {
        this._blitStaticLayers();
        this.ctx.save();
        this.ctx.translate(this.viewTransform.x, this.viewTransform.y);
        this.ctx.scale(this.viewTransform.scale, this.viewTransform.scale);
        this.renderDynamicObjects(this.ctx);
        this.ctx.restore();
    }
    
    _drawGlobal() {
        this._blitStaticLayers();
        this.ctx.save();
        this.ctx.translate(this.viewTransform.x, this.viewTransform.y);
        this.ctx.scale(this.viewTransform.scale, this.viewTransform.scale);
        this.factions.renderFactionLabels(this.ctx, this.viewTransform.scale);
        if (this.armyAnimations && this.armyAnimations.size > 0) {
            this.armies.render(this.ctx, this.viewTransform.scale);
        }
        this.ctx.restore();
    }
    
    _drawDetail(visibleRect) {
        const dpr = window.devicePixelRatio || 1;
        if (this.canvas.width !== Math.round(this.canvas.clientWidth * dpr)) {
            this.canvas.width = Math.round(this.canvas.clientWidth * dpr);
            this.canvas.height = Math.round(this.canvas.clientHeight * dpr);
        }
    
        this.perf.markStart('detailCache.check');
        if (this._needsDetailRepaint(visibleRect)) {
            this._repaintDetailCache(visibleRect);
        }
        this.perf.markEnd('detailCache.check');
    
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
    
        // Блит закэшированной статики — O(1), не зависит от числа регионов
        this.perf.markStart('detailCache.blit');
        const cache = this.detailCache;
        const r = cache.coveredRect;
        const screenX = r.minX * this.viewTransform.scale + this.viewTransform.x;
        const screenY = r.minY * this.viewTransform.scale + this.viewTransform.y;
        const screenW = (r.maxX - r.minX) * this.viewTransform.scale;
        const screenH = (r.maxY - r.minY) * this.viewTransform.scale;
        this.ctx.drawImage(cache.canvas, screenX, screenY, screenW, screenH);
        this.perf.markEnd('detailCache.blit');
    
        // Динамика — по-прежнему рисуется каждый кадр в мировых координатах
        this.ctx.save();
        this.ctx.translate(this.viewTransform.x, this.viewTransform.y);
        this.ctx.scale(this.viewTransform.scale, this.viewTransform.scale);
        
        this.perf.markStart('renderDynamicObjects');
        this.renderDynamicObjects(this.ctx, visibleRect);
        this.perf.markEnd('renderDynamicObjects');
        
       

        this.ctx.restore();
    }

    updateViewLevel(visibleRect) {
        const count = this.countVisibleRegions(visibleRect);
        const levels = ['detail', 'overview', 'global'];
        const thresholds = [this.sharpRegionBudget, this.globalRegionThreshold, Infinity];
        const currentIdx = levels.indexOf(this.viewLevel);
    
        let targetIdx = thresholds.findIndex(t => count <= t);
    
        if (targetIdx > currentIdx && count < thresholds[currentIdx]) targetIdx = currentIdx;
        if (targetIdx < currentIdx && count > thresholds[targetIdx]) targetIdx = currentIdx;
    
        this.viewLevel = levels[targetIdx];
    }
    
    renderDynamicObjects(ctx, visibleRect) {
        this.armies.renderOccupationHatching(ctx, visibleRect);
        this.towns.render(ctx, visibleRect);
        this.armies.renderReachableArea(ctx);
        this.selection.render(ctx);
        this.armies.render(ctx);
    }
    
    getVisibleWorldRect(margin = 40) {
        const vt = this.viewTransform;
        const minX = (0 - vt.x) / vt.scale - margin;
        const minY = (0 - vt.y) / vt.scale - margin;
        const maxX = (this.canvas.width - vt.x) / vt.scale + margin;
        const maxY = (this.canvas.height - vt.y) / vt.scale + margin;
        return { minX, minY, maxX, maxY };
    }
    
    bboxIntersects(bbox, rect) {
        return bbox.maxX >= rect.minX && bbox.minX <= rect.maxX &&
               bbox.maxY >= rect.minY && bbox.minY <= rect.maxY;
    }
    _paintTerrainContent(ctx, rect = null) {
        this.terrain.regions.render(ctx, rect);
        this.rivers.paint(ctx, rect);
        this.rivers.paintBridges(ctx, rect);
        this.paintCoastline(ctx, rect);
        this.decorations.paintTextures(ctx, rect);
        this.pixelDecor.paint(ctx, rect, 0.4)
    }
    scheduleRender() {
        if (this._renderScheduled) return;
        this._renderScheduled = true;
        requestAnimationFrame(() => {
            this._renderScheduled = false;
            this.render();
        });
    }
    _createLayer() {
        const canvas = document.createElement('canvas');
        canvas.width = this.width * this.mapLayerScale;
        canvas.height = this.height * this.mapLayerScale;
        return { canvas, ctx: canvas.getContext('2d'), dirty: true };
    }
    
    markDirty(...layerNames) {
        layerNames.forEach(name => {
            if (this.layers[name]) this.layers[name].dirty = true;
        });
    }
    
    _paintTerrainLayer() {
        const ctx = this.layers.terrain.ctx;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.layers.terrain.canvas.width, this.layers.terrain.canvas.height);
        ctx.scale(this.mapLayerScale, this.mapLayerScale);
        this._paintTerrainContent(ctx);
        ctx.restore();
    }
    
    _paintPoliticalLayer() {
        const ctx = this.layers.political.ctx;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.layers.political.canvas.width, this.layers.political.canvas.height);
        ctx.scale(this.mapLayerScale, this.mapLayerScale);
        this.factions.drawBorders(ctx); 
        ctx.restore();
    }
    _paintFogLayer(playerFactionId) {
        const ctx = this.layers.fog.ctx;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.layers.fog.canvas.width, this.layers.fog.canvas.height);
        if (!this.fogEnabled || playerFactionId === null || playerFactionId === undefined) {
            ctx.restore();
            return;
        }
        ctx.scale(this.mapLayerScale, this.mapLayerScale);
        this._paintFogRegions(ctx);
        ctx.restore();
    }
    paintCoastline(ctx, visibleRect) {
        if (!this.edgeMap) return;
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
        ctx.lineWidth = 0.4;
        ctx.lineJoin = 'round';
        ctx.filter = 'blur(4px)'
    
        this.edgeMap.forEach(edge => {
            if (visibleRect) {
                const ex = Math.min(edge.p1[0], edge.p2[0]), eX = Math.max(edge.p1[0], edge.p2[0]);
                const ey = Math.min(edge.p1[1], edge.p2[1]), eY = Math.max(edge.p1[1], edge.p2[1]);
                if (eX < visibleRect.minX || ex > visibleRect.maxX || eY < visibleRect.minY || ey > visibleRect.maxY) return;
            }
            if (edge.regionIds.length < 2) return;
            const [a, b] = edge.regionIds;
            const ra = this.terrain.regions.all[a], rb = this.terrain.regions.all[b];
            if (ra.isWater === rb.isWater) return; 
    
            const segments = this.getNoisyLineSegments(edge.p1[0], edge.p1[1], edge.p2[0], edge.p2[1]);
            ctx.beginPath();
            segments.forEach((pt, k) => k === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
            ctx.stroke();
        });
        ctx.filter = 'none';
        ctx.restore();
    }
    repaintLayersIfDirty() {
        if (this.layers.terrain.dirty) { this._paintTerrainLayer(); this.layers.terrain.dirty = false; this._rebuildStaticComposite() }
        if (this.layers.political.dirty) { this._paintPoliticalLayer(); this.layers.political.dirty = false; this._rebuildStaticComposite() }
        if (this.layers.fog.dirty) { this._paintFogLayer(this.playerFactionId); this.layers.fog.dirty = false; this._rebuildStaticComposite() }
        
    }
    countVisibleRegions(visibleRect) {
        let count = 0;
        for (let i = 0; i < this.terrain.regions.all.length; i++) {
            if (this.bboxIntersects(this.terrain.regions.all[i].bbox, visibleRect)) count++;
        }
        return count;
    }
    
    
    focusOnRegion(regionId, targetScale = 2.5) {
        const region = this.terrain.regions.all[regionId];
        if (!region) return;
    
        const scale = Math.min(this.maxScale, Math.max(this.minScale, targetScale));
        this.viewTransform.scale = scale;
        this.viewTransform.x = this.canvas.width / 2 - region.x * scale;
        this.viewTransform.y = this.canvas.height / 2 - region.y * scale;
    
        this.scheduleRender();
    }
    computeRegionLabelPath(region, polygon) {
        let cx = 0, cy = 0;
        polygon.forEach(([x, y]) => { cx += x; cy += y; });
        cx /= polygon.length; cy /= polygon.length;
        
        let sxx = 0, syy = 0, sxy = 0;
        polygon.forEach(([x, y]) => {
            const dx = x - cx, dy = y - cy;
            sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
        });
        const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    
        let minProj = Infinity, maxProj = -Infinity;
        polygon.forEach(([x, y]) => {
            const proj = (x - cx) * Math.cos(angle) + (y - cy) * Math.sin(angle);
            if (proj < minProj) minProj = proj;
            if (proj > maxProj) maxProj = proj;
        });
        return { cx, cy, angle, length: maxProj - minProj };
    }




    _needsDetailRepaint(visibleRect) {
        const cache = this.detailCache;
        if (!cache.valid || !cache.coveredRect) return true;
        const r = cache.coveredRect;
        return visibleRect.minX < r.minX || visibleRect.maxX > r.maxX ||
            visibleRect.minY < r.minY || visibleRect.maxY > r.maxY;
    }
    _repaintDetailCache(visibleRect) {
        const margin = (visibleRect.maxX - visibleRect.minX) * 0.6; // запас в 60% ширины экрана в каждую сторону
        const coveredRect = {
            minX: visibleRect.minX - margin, maxX: visibleRect.maxX + margin,
            minY: visibleRect.minY - margin, maxY: visibleRect.maxY + margin,
        };

        const dpr = window.devicePixelRatio || 1;
        const worldW = coveredRect.maxX - coveredRect.minX;
        const worldH = coveredRect.maxY - coveredRect.minY;
        const pxPerWorldUnit = this.viewTransform.scale * dpr;

        const canvas = this.detailCache.canvas;
        canvas.width = Math.round(worldW * pxPerWorldUnit);
        canvas.height = Math.round(worldH * pxPerWorldUnit);

        const ctx = this.detailCache.ctx;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.scale(pxPerWorldUnit, pxPerWorldUnit);
        ctx.translate(-coveredRect.minX, -coveredRect.minY);
    
        this._paintTerrainContent(ctx, coveredRect);
        this.factions.drawBorders(ctx, coveredRect);
        this._paintFogRegions(ctx, coveredRect); // ← см. пункт 4
    
        ctx.restore();
    
        this.detailCache.valid = true;
        this.detailCache.coveredRect = coveredRect;
        this.detailCache.scale = this.viewTransform.scale;
    }
    _paintFogRegions(ctx, rect = null) {
        const visible = this.getCachedVisibility();
        if (!visible) return;
        for (let i = 0; i < this.terrain.regions.all.length; i++) {
            if (visible[i]) continue;
            const region = this.terrain.regions.all[i];
            if (rect && !this.bboxIntersects(region.bbox, rect)) continue;
            const polygon = this.mapVoronoi.cellPolygon(i);
            if (!polygon) continue;
            ctx.fillStyle = this.fogColor; // см. ниже, единая константа
            this.drawRegionPath(ctx, polygon);
            ctx.fill();
        }
    }
    _invalidateDetailCache() {
        this.detailCache.valid = false;
    }
    _invalidateVisibilityCache() {
        this._cachedVisibility = null;
    }
    _invalidateAdjacencyCache() {
        this._cachedAdjacency = null;
    }
    
    getCachedVisibility() {
        if (!this.fogEnabled || this.playerFactionId === null || this.playerFactionId === undefined) return null;
        if (!this._cachedVisibility) {
            this._cachedVisibility = this.factions.computeVisibility(this.playerFactionId, this.fogVisionHops ?? 2);
        }
        return this._cachedVisibility;
    }
    _rebuildStaticComposite() {
        const { width: w, height: h } = this.layers.terrain.canvas;
        if (!this._composite) this._composite = document.createElement('canvas');
        if (this._composite.width !== w || this._composite.height !== h) {
            this._composite.width = w;
            this._composite.height = h;
        }
        const c = this._composite.getContext('2d');
        c.clearRect(0, 0, w, h);
        ['terrain', 'political', 'fog'].forEach(n => c.drawImage(this.layers[n].canvas, 0, 0));
    
        createImageBitmap(this._composite).then(bmp => {
            this._compositeBitmap?.close();
            this._compositeBitmap = bmp;
            this.scheduleRender();
        });
    }
}
// ═══════════════════════════════════════════════════════════
// SECTION: MAP_COLORS
// Всё, что превращает состояние региона (биом/сезон/фракция)
// в конкретный цвет для заливки. Читает MAP_CONFIG + this.viewMode.
// ═══════════════════════════════════════════════════════════
const MapColor = {
    getBase(region, resourceRange) {
        if (this.viewMode === 'factions') {
            return this.color.getGrayscale(region);
        }
        if (this.viewMode === 'culture') {
            if (region.isWater || !region.culture) return '#1a2540';
            const dominant = this.cultures.getDominantOfRegion(region);
            const baseColor = this.cultureColorById[dominant];
            const share = region.culture[dominant];
            return this.color.blend('#6b7280', baseColor, share);
        }
        if (!region.isWater && ['food', 'gold', 'production', 'manpower', 'ether'].includes(this.viewMode)) {
            return this.color.getResourceColor(region, this.viewMode, resourceRange);
        }
        region.biome = region.isWater ? region.biomeClimate : (this.showClimate ? region.biomeClimate : region.biomeNeutral);
        
        const baseColor = this.biomesMap[region.biome];
        if (!baseColor) return baseColor;

        const tintGroup = this.seasons[this.currentSeason]?.tints;
        if (!tintGroup) return baseColor;

        const zone = region.climateZone || 'temperate';
        const tint = (region.isWater ? tintGroup.water : tintGroup.land)[zone];
        if (!tint || tint.strength <= 0) return baseColor;
        
       
        return this.color.blend(baseColor, tint.color, tint.strength);
    },
    getGrayscale(region) {
        if (region.isWater) {
            const v = 25 + region.t * 35;
            return this.color.rgbToHex(v * 0.7, v * 0.8, v * 1.05);
        }
        const v = 110 + region.t * 95;
        return this.color.rgbToHex(v, v, v);
    },
    hexToRgb(hex) {
        const h = hex.replace('#', '');
        return { r: parseInt(h.substring(0, 2), 16), g: parseInt(h.substring(2, 4), 16), b: parseInt(h.substring(4, 6), 16) };
    },
    rgbToHex(r, g, b) {
        const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
        return '#' + [clamp(r), clamp(g), clamp(b)].map(v => v.toString(16).padStart(2, '0')).join('');
    },
    hslToHex(h, s, l) {
        s /= 100; l /= 100;
        const k = n => (n + h / 30) % 12;
        const a = s * Math.min(l, 1 - l);
        const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
        return this.color.rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
    },
    blend(baseHex, tintHex, amount) {
        if (amount <= 0) return baseHex;
        const base = this.color.hexToRgb(baseHex), tint = this.color.hexToRgb(tintHex);
        return this.color.rgbToHex(
            base.r + (tint.r - base.r) * amount,
            base.g + (tint.g - base.g) * amount,
            base.b + (tint.b - base.b) * amount
        );
    },
    getResourceRange(key) {
        let min = Infinity, max = -Infinity;
        this.terrain.regions.all.forEach(region => {
            const res = this.getRegionResources(region);
            if (!res) return;
            const v = res[key];
            if (v < min) min = v;
            if (v > max) max = v;
        });
        if (!isFinite(min)) { min = 0; max = 1; }
        if (min === max) max = min + 1; // защита от деления на 0, если все значения одинаковы
        return { min, max };
    },
    
    getResourceColor(region, key, range) {
        const res = this.getRegionResources(region);
        if (!res) return '#333333';
    
        const scales = {
            food:       ['#7a1f1f', '#2f9e44'], // мало — красный, много — зелёный
            gold:       ['#4a2e1a', '#e08e2b'], // мало — коричневый, много — оранжевый
            production: ['#d7e6f2', '#12294f'], // мало — бледно-голубой, много — насыщенный тёмно-синий
            ether:      ['#d7e6f2', '#12294f'], // мало — бледно-голубой, много — насыщенный тёмно-синий
            manpower:   ['#dbd7d8', '#e83a63'], // мало — бледно-голубой, много — насыщенный тёмно-синий
               
        };
        const [lowColor, highColor] = scales[key];
    
        const t = Math.max(0, Math.min(1, (res[key] - range.min) / (range.max - range.min)));
        return this.color.blend(lowColor, highColor, t);
    },
}

// ═══════════════════════════════════════════════════════════
// SECTION: MAP_INTERACTION
// Ввод пользователя, не связанный с камерой: тултип, события,
// поиск региона под курсором, текстовое описание региона.
// ═══════════════════════════════════════════════════════════
const MapInteraction = {
    initEvents() {
        this.canvas.style.cursor = 'grab';
        this.canvas.addEventListener('mousedown', e => this.interaction._handleMouseDown(e));
        window.addEventListener('mouseup', e => this.interaction._handleMouseUp(e));
        this.canvas.addEventListener('mousemove', e => this.interaction._handleMouseMove(e));
        this.canvas.addEventListener('wheel', e => this.interaction._handleWheel(e), { passive: false });
        this.canvas.addEventListener('touchstart', e => {
            if (e.touches.length) this.interaction.handlePointerAt(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
    },
    handlePointerAt(clientX, clientY) {
        if (!this.terrain.regions.all.length) return;
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const px = (clientX - rect.left) * scaleX;
        const py = (clientY - rect.top) * scaleY;

        const wx = (px - this.viewTransform.x) / this.viewTransform.scale;
        const wy = (py - this.viewTransform.y) / this.viewTransform.scale;

        const idx = this.terrain.findNeighbor(this.terrain.regions.all, wx, wy);
    },
    selectRegionAt(clientX, clientY) {
        if (!this.terrain.regions.all.length) return null;
    
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const px = (clientX - rect.left) * scaleX;
        const py = (clientY - rect.top) * scaleY;
    
        const wx = (px - this.viewTransform.x) / this.viewTransform.scale;
        const wy = (py - this.viewTransform.y) / this.viewTransform.scale;
    
        if (wx < 0 || wy < 0 || wx > this.width || wy > this.height) {
            this.selection.clear();
            return null;
        }
    
        const idx = this.terrain.findNeighbor(this.terrain.regions.all, wx, wy);
        if (idx === -1) {
            this.selection.clear();
            return null;
        }
    
        const region = this.terrain.regions.all[idx];
        const wasArmySelected = this.selection.armyId;
        const previousArmyRegionId = wasArmySelected
            ? this.armiesProvider?.().find(a => a.id === this.selection.armyId)?.regionId
            : null;
    
        if (wasArmySelected) {
            if (this.selection.reachableSet && this.selection.reachableSet.has(idx)) {
                if (this.selection.onMoveRequest) this.selection.onMoveRequest(this.selection.armyId, idx);
                this.selection.clear();
                return null;
            }
            this.selection.armyId = null;
            this.selection.reachableSet = null;
    
            if (idx === previousArmyRegionId) {
                this.selection.regionId = region.id;
                this.scheduleRender();
                const regionData = this.getRegionData(region);
                if (this.selection.onSelect) this.selection.onSelect(regionData);
                return regionData;
            }
        }
    
        const armiesHere = this.armiesProvider ? this.armiesProvider().filter(a => a.regionId === region.id) : [];
        const ownArmy = armiesHere.find(a => a.factionId === this.playerFactionId);
    
        if (ownArmy) {
            this.selection.regionId = null;
            this.armies.select(ownArmy.id);
            return null;
        }
    
        this.selection.regionId = region.id;
        this.selection.armyId = null;
        this.selection.reachableSet = null;
        this.scheduleRender();
    
        const regionData = this.getRegionData(region);
        if (this.selection.onSelect) this.selection.onSelect(regionData);
        return regionData;
    },
    _handleWheel(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const px = (e.clientX - rect.left) * scaleX;
        const py = (e.clientY - rect.top) * scaleY;

        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const newScale = Math.min(this.maxScale, Math.max(this.minScale, this.viewTransform.scale * factor));

        const worldX = (px - this.viewTransform.x) / this.viewTransform.scale;
        const worldY = (py - this.viewTransform.y) / this.viewTransform.scale;

        this.viewTransform.scale = newScale;
        this.viewTransform.x = px - worldX * newScale;
        this.viewTransform.y = py - worldY * newScale;
    
        this.scheduleRender(); 

        clearTimeout(this.interaction.wheelDebounceTimer);
        this.interaction.wheelDebounceTimer = setTimeout(() => {
            this._invalidateDetailCache(); // форсируем свежую перезаливку под финальный масштаб
            this.markDirty('political');
            this.render();
        }, 60);
    },
    _handleMouseDown(e) {
        this._isPanning = true;
        this._panStart = { x: e.clientX, y: e.clientY };
        this._transformStart = { x: this.viewTransform.x, y: this.viewTransform.y };
        this.canvas.style.cursor = 'grabbing';
    },
    _handleMouseUp(e) {
        this._isPanning = false;
        this.canvas.style.cursor = 'grab';
    
        const dx = e.clientX - this._panStart.x;
        const dy = e.clientY - this._panStart.y;
        const dragDistance = Math.hypot(dx, dy);
    
        if (dragDistance < 5) {
            this.interaction.selectRegionAt(e.clientX, e.clientY);
        }
    
        //this.scheduleRender();
    },
    _handleMouseMove(e) {
        if (this._isPanning) {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            const dx = (e.clientX - this._panStart.x) * scaleX;
            const dy = (e.clientY - this._panStart.y) * scaleY;
    
            this.viewTransform.x = this._transformStart.x + dx;
            this.viewTransform.y = this._transformStart.y + dy;
    
            this.scheduleRender();
            return;
        }
        this.interaction.handlePointerAt(e.clientX, e.clientY);
    }
}

// ═══════════════════════════════════════════════════════════
// SECTION: MAP_FACTIONS
// Расстановка государств поверх готового ландшафта: столицы,
// территория (BFS), население, цвета. Часть первичного setup(),
// но логически отдельная от рельефа — государства можно
// в будущем пересобирать без пересчёта terrain.
// ═══════════════════════════════════════════════════════════

const MapFaction = {
    getTotal() {
        if (this.factions.config.count) return this.factions.config.count;
        const scaled = Math.round(this.terrain.config.regionCount / 40);
        return Math.max(8, Math.min(70, scaled));
    },
    settle(regions, neighborsList) {
        regions.forEach(s => { s.city = null; s.population = 0; });

        const total = Math.min(this.factions.getTotal(), this.terrain.maxFactions ?? 30);
        this.factions.list = [];
        if (total <= 0) return;
    
        const names = this.factions.config.names?.length === total ? this.factions.config.names : null;
    
        // Раздаём цвета равномерно по культурам — не более (total/6 + запас) фракций одной культуры одновременно
        const shuffledPalette = [...this.factions.colors.all].sort(() => this.utils.seededRandom() - 0.5);
        const assignedColors = shuffledPalette.slice(0, total);
    
        const candidatesAll = regions.filter(s => !s.isWater && s.biomeBand !== 'PEAKS' && s.biomeBand !== 'HIGHLANDS');
    
        const capitals = [];
        const usedRegionIds = new Set();
    
        assignedColors.forEach((colorDef, i) => {
            const matching = candidatesAll.filter(r =>
                !usedRegionIds.has(r.id) && r.culture && this.cultures.getDominantOfRegion(r) === colorDef.culture
            );
            const pool = matching.length ? matching : candidatesAll.filter(r => !usedRegionIds.has(r.id));
            if (!pool.length) return;
    
            let capital = pool[0];
            if (capitals.length) {
                let bestDist = -Infinity;
                pool.forEach(r => {
                    const minDist = Math.min(...capitals.map(c => Math.hypot(c.x - r.x, c.y - r.y)));
                    if (minDist > bestDist) { bestDist = minDist; capital = r; }
                });
            } else {
                capital = pool[Math.floor(this.utils.seededRandom() * pool.length)];
            }
    
            usedRegionIds.add(capital.id);
            capitals.push(capital);
    
            const factionName = names ? names[i] : `${colorDef.id} (${colorDef.culture})`;
            capital.city = { name: factionName + ' (столица)' };
    
            this.factions.list.push({
                id: i,
                name: factionName,
                colorId: colorDef.id,
                color: colorDef.hex, // обратная совместимость со всем кодом, читающим faction.color напрямую
                culture: colorDef.culture, // культура ПРИВЯЗАНА к цвету, а не выбирается отдельно постфактум
                capitalRegionId: capital.id,
                ownedRegions: [],
                totalPopulation: 0,
                armies: [],
                flagVariant: 1 + Math.floor(this.utils.seededRandom() * (3)),
            });
        });

        const ownerOf = new Int16Array(regions.length).fill(-1);
        const hopOf = new Int16Array(regions.length).fill(-1);

        let frontier = capitals.map((capital, factionId) => {
            ownerOf[capital.id] = factionId;
            hopOf[capital.id] = 0;
            return capital.id;
        });

        for (let depth = 1; depth <= this.factions.startHops && frontier.length; depth++) {
            const nextFrontier = [];
            for (const id of frontier) {
                const factionId = ownerOf[id];
                for (const nb of neighborsList[id]) {
                    if (ownerOf[nb] !== -1 || regions[nb].isWater) continue;
                    ownerOf[nb] = factionId;
                    hopOf[nb] = depth;
                    nextFrontier.push(nb);
                }
            }
            frontier = nextFrontier;
        }

        regions.forEach((region, i) => {
            region.ownerId = ownerOf[i] === -1 ? null : ownerOf[i];
            region.population = region.ownerId === null
                ? 0
                : Math.round(this.factions.capitalPopulation * Math.pow(this.factions.populationDecay, hopOf[i]));
        });


        this.factions.list.forEach(faction => {
            const owned = regions.filter(s => s.ownerId === faction.id);
            faction.ownedRegions = owned.map(s => s.id);
            faction.totalPopulation = owned.reduce((sum, s) => sum + s.population, 0);
            faction.armies.push({ id: `${faction.id}-army-0`, regionId: faction.capitalRegionId, strength: 10 });
        });
    },
    getFactionFlagKey(faction) {
        return faction.flagVariant ? `flag-${faction.colorId}-${faction.flagVariant}` : `flag-${faction.colorId}-1`;
    },
    getFactionFlagImage(faction) {
        const key = this.factions.getFactionFlagKey(faction)
        if(!this.assets.get(key)) this.assets.load(key)
        return this.assets.get(key);
    },
    drawBorders(ctx, visibleRect = null) {
        if (!this.factions.list || !this.factions.list.length || !this.edgeMap) return;
        ctx.lineJoin = 'round';
        const useFactionColors = true
        ctx.globalAlpha = 0.5
        ctx.filter = 'blur(2px)'
        this.factions.drawBorderEdges(ctx, 0.4, 0.6, visibleRect, useFactionColors);
        ctx.globalAlpha = 1
        ctx.filter = 'none'
        ctx.setLineDash([0.5, 0.5]);
        this.factions.drawBorderEdges(ctx, 0.3, 0.2, visibleRect, !useFactionColors);
        ctx.setLineDash([]);
    },
    drawBorderEdges(ctx, offset, width, visibleRect, useFactionColors){
        const resolveColor = (ownerId) => {
            if (ownerId === null || ownerId === undefined) return this.factions.colors.neutral;
            if (useFactionColors) return this.factions.list[ownerId]?.color || this.factions.colors.neutral;
            return this.factions.getDiplomaticColor
                ? this.factions.getDiplomaticColor(ownerId)
                : (this.factions.list[ownerId]?.color || this.factions.colors.neutral);
        };
        this.edgeMap.forEach(edge => {
            if (edge.regionIds.length < 2) return;
            const [a, b] = edge.regionIds;
            const regionA = this.terrain.regions.all[a], regionB = this.terrain.regions.all[b];
            
            if (regionA.ownerId === regionB.ownerId) return;

            const visible = this.fogEnabled && this.playerFactionId !== null && this.playerFactionId !== undefined
            ? this.getCachedVisibility() : null;
            
            if (visible && !visible[regionA.id] && !visible[regionB.id]) return; 
            if (!this.exploredRegions.has(a) && !this.exploredRegions.has(b)) return; 

            if (visibleRect) {
                const ex = Math.min(edge.p1[0], edge.p2[0]), eX = Math.max(edge.p1[0], edge.p2[0]);
                const ey = Math.min(edge.p1[1], edge.p2[1]), eY = Math.max(edge.p1[1], edge.p2[1]);
                if (eX < visibleRect.minX || ex > visibleRect.maxX || eY < visibleRect.minY || ey > visibleRect.maxY) return;
            }

            const segments = this.getNoisyLineSegments(edge.p1[0], edge.p1[1], edge.p2[0], edge.p2[1]);

            const dx = edge.p2[0] - edge.p1[0], dy = edge.p2[1] - edge.p1[1];
            const len = Math.hypot(dx, dy) || 1;
            let nx = -dy / len, ny = dx / len;

            const midX = (edge.p1[0] + edge.p2[0]) / 2, midY = (edge.p1[1] + edge.p2[1]) / 2;
            const towardA = (regionA.x - midX) * nx + (regionA.y - midY) * ny;
            if (towardA < 0) { nx = -nx; ny = -ny; }

            const colorA = resolveColor(regionA.ownerId);
            const colorB = resolveColor(regionB.ownerId);
           
            this.utils.strokeOffsetPolyline(ctx, segments, nx, ny, offset, colorA, width);
            this.utils.strokeOffsetPolyline(ctx, segments, -nx, -ny, offset, colorB, width);

        });
    },

    getFactionAdjacency() {
        if (this._cachedAdjacency) return this._cachedAdjacency;
        const count = this.factions.list.length;
        const adjacency = Array.from({ length: count }, () => new Set());
        this.edgeMap.forEach(edge => {
            if (edge.regionIds.length < 2) return;
            const [a, b] = edge.regionIds;
            const ownerA = this.terrain.regions.all[a].ownerId;
            const ownerB = this.terrain.regions.all[b].ownerId;
            if (ownerA === null || ownerB === null || ownerA === undefined || ownerB === undefined) return;
            if (ownerA === ownerB) return;
            adjacency[ownerA].add(ownerB);
            adjacency[ownerB].add(ownerA);
        });

        this._cachedAdjacency = adjacency;
        return adjacency;
    },
    getNeighboringFactions(factionId) {
        const adjacency = this.factions.getFactionAdjacency();
        return adjacency[factionId] ? [...adjacency[factionId]] : [];
    },
    computeVisibility(factionId, visionHops = 1) {
        const n = this.terrain.regions.all.length;
        const visible = new Uint8Array(n);
        if (factionId === null || factionId === undefined) return visible;
    
        let frontier = [];
        this.terrain.regions.all.forEach((r, i) => {
            
            if (r.ownerId === factionId) { visible[i] = 1; frontier.push(i); }
        });
    
        for (let hop = 0; hop < visionHops; hop++) {
            const next = [];
            frontier.forEach(id => {
                (this.regionNeighbors?.[id] || []).forEach(nb => {
                    if (!visible[nb]) { visible[nb] = 1; next.push(nb); }
                });
            });
            frontier = next;
        }
        return visible;
    },
    computeLabelPath(factionId) {
        const owned = this.terrain.regions.all.filter(r => r.ownerId === factionId && !r.isWater);
        if (!owned.length) return null;
    
        // центр масс
        let cx = 0, cy = 0;
        owned.forEach(r => { cx += r.x; cy += r.y; });
        cx /= owned.length; cy /= owned.length;
    
        // главная ось через 2x2 матрицу ковариации (упрощённый PCA)
        let sxx = 0, syy = 0, sxy = 0;
        owned.forEach(r => {
            const dx = r.x - cx, dy = r.y - cy;
            sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
        });
        const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    
        // приблизительная длина владений вдоль главной оси
        let minProj = Infinity, maxProj = -Infinity;
        owned.forEach(r => {
            const proj = (r.x - cx) * Math.cos(angle) + (r.y - cy) * Math.sin(angle);
            if (proj < minProj) minProj = proj;
            if (proj > maxProj) maxProj = proj;
        });
        const length = maxProj - minProj;
    
        return { cx, cy, angle, length };
    },
    renderFactionLabels(ctx, zoomScale) {
        if (!['factions', 'political', 'global'].includes(this.viewMode) && this.viewLevel !== 'global') return;
        if (!this.factions.list?.length) return;
    
        this.factions.list.forEach(faction => {
            if (this.fogEnabled && !this.factions.isDiscovered(faction.id)) return; // ← не показываем неоткрытую фракцию
    
            const path = this.factions.getLabelPath(faction.id);
            if (!path || path.length < 15) return;
            this.utils.drawCurvedLabel(ctx, faction.name.toUpperCase(), path.cx, path.cy, path.angle, path.length, zoomScale, {
                fontSize: 9, color: 'rgba(20, 15, 10, 0.85)',
            });
        });
    },
    getLabelPath(factionId) {
        if (this.factions.labelPathCache.has(factionId)) return this.factions.labelPathCache.get(factionId);
        const path = this.factions.computeLabelPath(factionId);
        this.factions.labelPathCache.set(factionId, path);
        return path;
    },
    isDiscovered(factionId) {
        if (factionId === this.playerFactionId) return true;
        for (const regionId of this.exploredRegions) {
            if (this.terrain.regions.all[regionId]?.ownerId === factionId) return true;
        }
        return false;
    }
}

const MapTerrain = {
    renderRegions(ctx, visibleRect = null) {
        const resourceRange = ['food', 'gold', 'production', 'manpower', 'ether'].includes(this.viewMode)
        ? this.color.getResourceRange(this.viewMode)
        : null;

        for (let i = 0; i < this.terrain.regions.all.length; i++) {
            const polygon = this.mapVoronoi.cellPolygon(i);
            if (!polygon) continue;
            
            const region = this.terrain.regions.all[i];

            if (visibleRect && !this.bboxIntersects(region.bbox, visibleRect)) continue;
            const color = this.color.getBase(region, resourceRange);
            ctx.fillStyle = color;
            ctx.strokeStyle = (this.viewLevel === 'overview') ? color :  'rgba(0, 5, 0, 0.45)' ;
            ctx.lineWidth = 0.05;

            this.drawRegionPath(ctx, polygon);
            ctx.fill();
            ctx.stroke();

            if (region.ownerId !== null && region.ownerId !== undefined && this.factions.list?.[region.ownerId] && this.factions.isDiscovered(region.ownerId)) {
                ctx.save();
                ctx.globalAlpha = this.viewMode === 'factions' ? 0.65 : (this.viewMode === 'political') ? 0.42 : 0;
                ctx.fillStyle = this.factions.list[region.ownerId].color;
                ctx.fill();
                ctx.restore();
            }
        }
    },
    createRegions(width, height, iterations = 2) {
        let regions = [];
        for (let i = 0; i < this.terrain.config.regionCount; i++) {
            regions.push({ x: this.utils.seededRandom() * width, y: this.utils.seededRandom() * height });
        }

        for (let iter = 0; iter < iterations; iter++) {
            const points = new Float64Array(regions.length * 2);
            for (let i = 0; i < regions.length; i++) {
                points[i * 2] = regions[i].x;
                points[i * 2 + 1] = regions[i].y;
            }
            const delaunay = new d3.Delaunay(points);
            const voronoi = delaunay.voronoi([0, 0, width, height]);

            const newRegions = [];
            for (let i = 0; i < regions.length; i++) {
                const polygon = voronoi.cellPolygon(i);
                if (!polygon) { newRegions.push(regions[i]); continue; }

                let cx = 0, cy = 0, area = 0;
                for (let j = 0; j < polygon.length - 1; j++) {
                    const p1 = polygon[j], p2 = polygon[j + 1];
                    const cross = p1[0] * p2[1] - p2[0] * p1[1];
                    area += cross;
                    cx += (p1[0] + p2[0]) * cross;
                    cy += (p1[1] + p2[1]) * cross;
                }
                area *= 0.5;

                if (Math.abs(area) > 1e-5) {
                    cx /= (6 * area); cy /= (6 * area);
                    cx = Math.max(10, Math.min(width - 10, cx));
                    cy = Math.max(10, Math.min(height - 10, cy));
                    newRegions.push({ x: cx, y: cy });
                } else {
                    newRegions.push(regions[i]);
                }
            }
            regions = newRegions;
        }
        return regions;
    },
    createTemperatures(regions, landT) {
        const n = regions.length;
        const temp = new Float64Array(n);
        const phase = this.utils.seededRandom() * Math.PI * 2;
        for (let i = 0; i < n; i++) {
            const nx = regions[i].x / this.width, ny = regions[i].y / this.height;
            const wobble = Math.sin(nx * Math.PI * 2.2 + phase) * 0.07 + Math.sin(nx * Math.PI * 5.0 - phase) * 0.035;
            let val = ny + wobble;
            val -= landT[i] * 0.2;
            temp[i] = Math.min(1, Math.max(0, val));
        }
        return temp;
    },
    addBlob(elevation, neighborsList, startId, height, decayBase, plateauHops = 0) {
        elevation[startId] += height;
        this.terrain.spreadDecay(elevation, neighborsList, [startId], height, decayBase, 0.12, plateauHops, 0.97, 0.06);
    },
    addRange(elevation, neighborsList, regions, startId, endId, height, decayBase) {
        const path = [startId];
        let current = startId;
        let guard = 0;
        while (current !== endId && guard < neighborsList.length) {
            guard++;
            let best = null, bestScore = Infinity;
            for (const nb of neighborsList[current]) {
                const dx = regions[nb].x - regions[endId].x;
                const dy = regions[nb].y - regions[endId].y;
                const d = Math.hypot(dx, dy) + this.utils.seededRandom() * 60;
                if (d < bestScore) { bestScore = d; best = nb; }
            }
            if (best === null || best === current) break;
            current = best;
            path.push(current);
            if (path.length > 200) break;
        }
    
        path.forEach(id => {
            elevation[id] += height * (0.65 + this.utils.seededRandom() * 0.35);
        });
        this.terrain.spreadDecay(elevation, neighborsList, path, height * 0.85, decayBase, 0.1);
    },
    spreadDecay(elevation, neighborsList, seedIds, initialHeight, decayBase, jitter, plateauHops = 0, plateauDecay = 0.97, plateauJitter = 0.06) {
        const used = new Uint8Array(elevation.length);
        const queue = [...seedIds];
        seedIds.forEach(id => used[id] = 1);
        let h = initialHeight;
        let qi = 0;
        let visited = 0;
        while (qi < queue.length) {
            const id = queue[qi++];
            for (const nb of neighborsList[id]) {
                if (used[nb]) continue;
                used[nb] = 1;
                visited++;
                h = visited > plateauHops
                    ? h * (decayBase + (this.utils.seededRandom() * jitter - jitter / 2))
                    : h * (plateauDecay + (this.utils.seededRandom() * plateauJitter - plateauJitter / 2));
                if (h < 0.02) continue;
                elevation[nb] += h;
                queue.push(nb);
            }
        }
    },
    createNeighbors(delaunay, n) {
        const neighbors = new Array(n);
        for (let i = 0; i < n; i++) neighbors[i] = Array.from(delaunay.neighbors(i));
        return neighbors;
    },
    findNeighbor(regions, x, y) {
        let best = 0, bestD = Infinity;
        for (let i = 0; i < regions.length; i++) {
            const d = (regions[i].x - x) ** 2 + (regions[i].y - y) ** 2;
            if (d < bestD) { bestD = d; best = i; }
        }
        return best;
    },
    getContinentCenters(densityScale) {
        const jitter = () => (this.utils.seededRandom() - 0.5);
        switch (this.terrain.config.shapeType) {
            case 'two_continents':
                const centers = [
                    { x: 0.28 + jitter() * 0.12, y: 0.5 + jitter() * 0.25, w: 1.0 },
                    { x: 0.72 + jitter() * 0.12, y: 0.5 + jitter() * 0.25, w: 1.0 },
                ];
                //const satellites = Math.round((1 + Math.floor(this.utils.seededRandom() * 7)) * densityScale);
                const satellites = 7;
                for (let i = 0; i < satellites; i++) {
                    const ang = this.utils.seededRandom() * Math.PI * 2;
                    const dist = 0.18 + this.utils.seededRandom() * 0.12;
                    centers.push({
                        x: 0.5 + Math.cos(ang) * dist,
                        y: 0.48 + Math.sin(ang) * dist,
                        w: 0.55 + this.utils.seededRandom() * 0.35,
                    });
                }
                return centers;
            case 'island':
                return [{ x: 0.5 + jitter() * 0.1, y: 0.5 + jitter() * 0.1, w: 0.85 }];
            case 'continent':
            default: {
                const centers = [
                    { x: 0.20 + jitter() * 0.12, y: 0.25 + jitter() * 0.25, w: 1.0 },
                    { x: 0.50 + jitter() * 0.12, y: 0.75 + jitter() * 0.25, w: 1.0 },
                    { x: 0.60 + jitter() * 0.12, y: 0.25 + jitter() * 0.25, w: 1.0 },
                ];
                const satellites = 4;
                for (let i = 0; i < satellites; i++) {
                    const ang = this.utils.seededRandom() * Math.PI * 2;
                    const dist = 0.18 + this.utils.seededRandom() * 0.12;
                    centers.push({
                        x: 0.5 + Math.cos(ang) * dist,
                        y: 0.48 + Math.sin(ang) * dist,
                        w: 0.55 + this.utils.seededRandom() * 0.35,
                    });
                }
                return centers;
            }
        }
    },
    createElevation(regions, neighborsList) {
        const n = regions.length;
        const elevation = new Float64Array(n);
        const seedTrig = (this.currentSeed % 1000) * 0.017;
        const seedPhase = this.utils.seededRandom() * Math.PI * 2;

        const densityScale = Math.sqrt(n / 600);

        const decayExponent = Math.min(1, 600 / n);
        const scaleDecay = (d) => Math.pow(d, decayExponent);

        elevation.fill(0);

        let blobDecay;
        if (this.terrain.config.shapeType === 'island') blobDecay = Math.min(0.997, Math.max(0.985, 0.993 + (this.terrain.config.landAmount - 1.0) * 0.004));
        else blobDecay = Math.min(0.994, Math.max(0.965, 0.982 + (this.terrain.config.landAmount - 1.0) * 0.018));
        blobDecay = scaleDecay(blobDecay);
        const centers = this.terrain.getContinentCenters(densityScale);

        centers.forEach(c => {
            const startId = this.terrain.findNeighbor(regions, c.x * this.width, c.y * this.height);
            const peak = (0.75 + this.utils.seededRandom() * 0.35) * c.w * this.terrain.config.landAmount;
            this.terrain.addBlob(elevation, neighborsList, startId, peak, blobDecay);
        });

        const scaledPeakCount = Math.round(this.terrain.config.peakCount * densityScale);
        if (scaledPeakCount > 0) {
            const landCandidates = [];
            for (let i = 0; i < n; i++) if (elevation[i] > 0.22) landCandidates.push(i);
            if (landCandidates.length > 3) {
                const peakBlobDecay = scaleDecay(0.86 + this.terrain.config.relief * 0.05);
                const rangeDecay = scaleDecay(0.90 + this.terrain.config.relief * 0.03);
                const peakPlateau = Math.max(3, Math.round(7 * densityScale));

                const chosenPeaks = [];
                const minPeakDist = 0.16;
                const pickSpacedCandidate = (avoidId) => {
                    for (let attempt = 0; attempt < 10; attempt++) {
                        const id = landCandidates[Math.floor(this.utils.seededRandom() * landCandidates.length)];
                        if (id === avoidId) continue;
                        const cx = regions[id].x / this.width, cy = regions[id].y / this.height;
                        if (!chosenPeaks.some(p => Math.hypot(p.x - cx, p.y - cy) < minPeakDist)) return id;
                    }
                    return landCandidates[Math.floor(this.utils.seededRandom() * landCandidates.length)];
                };

                for (let i = 0; i < scaledPeakCount; i++) {
                    const startId = pickSpacedCandidate(-1);
                    chosenPeaks.push({ x: regions[startId].x / this.width, y: regions[startId].y / this.height });

                    const peakHeight = (0.85 + this.utils.seededRandom() * 0.3) * (0.6 + this.terrain.config.relief);
                    const asRidge = this.utils.seededRandom() < this.terrain.config.peakShape;
                    if (asRidge) {
                        const endId = pickSpacedCandidate(startId);
                        if (endId === startId) { this.terrain.addBlob(elevation, neighborsList, startId, peakHeight, peakBlobDecay, peakPlateau); continue; }
                        this.terrain.addRange(elevation, neighborsList, regions, startId, endId, peakHeight, rangeDecay);
                    } else {
                        this.terrain.addBlob(elevation, neighborsList, startId, peakHeight, peakBlobDecay, peakPlateau);
                    }
                }
            }
        }

        for (let i = 0; i < n; i++) {
            const nx = regions[i].x / this.width, ny = regions[i].y / this.height;
            const detail = Math.sin(nx * 23.0 * densityScale + seedTrig) * Math.cos(ny * 19.0 * densityScale - seedTrig) * 0.5
                            + Math.sin(nx * 47.0 * densityScale - ny * 31.0 * densityScale) * 0.25;
            const chaosJitter = this.utils.seededRandom() * 2 - 1;
            elevation[i] *= (1 + detail * (0.15 + this.terrain.config.relief * 0.55) + chaosJitter * this.terrain.config.chaos * 0.65);
        }

        for (let i = 0; i < n; i++) {
            const isEdge = regions[i].x < this.borderMargin || regions[i].x > this.width - this.borderMargin
                        || regions[i].y < this.borderMargin || regions[i].y > this.height - this.borderMargin;
            if (isEdge) elevation[i] *= 0.15;
        }
        return elevation;
    },
    classifyByLandFraction(elevation, targetFraction) {
        const n = elevation.length;
        const sorted = Array.from(elevation).sort((a, b) => a - b);
        const idx = Math.min(n - 1, Math.max(0, Math.floor((1 - targetFraction) * n)));
        const waterLevel = sorted[idx];
        const min = sorted[0];

        const landElevations = sorted.slice(idx);
        const refIdx = Math.min(landElevations.length - 1, Math.floor(landElevations.length * 0.95));
        const landMaxRef = landElevations[refIdx] || sorted[n - 1];
        const waterRange = (waterLevel - min) || 1;
        const landRange = (landMaxRef - waterLevel) || 1;

        const landCeiling = 0.35 + 0.65 * this.terrain.config.relief;

        const isWater = new Uint8Array(n);
        const t = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            if (elevation[i] < waterLevel) {
                isWater[i] = 1;
                t[i] = Math.min(1, Math.max(0, (elevation[i] - min) / waterRange));
            } else {
                isWater[i] = 0;
                t[i] = Math.min(1, Math.max(0, (elevation[i] - waterLevel) / landRange)) * landCeiling;
            }
        }

        return { isWater, t };
    },
    cleanup(isWater, neighborsList, minLandSize) {
        const n = isWater.length;
        const visited = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            if (visited[i] || isWater[i]) continue;
            const component = [i];
            visited[i] = 1;
            let qi = 0;
            while (qi < component.length) {
                const id = component[qi++];
                for (const nb of neighborsList[id]) {
                    if (visited[nb] || isWater[nb]) continue;
                    visited[nb] = 1;
                    component.push(nb);
                }
            }
            if (component.length < minLandSize) {
                for (const id of component) isWater[id] = 1;
            }
        }
    },
}

const MapUtils = {
    strokeOffsetPolyline(ctx, points, nx, ny, offset, color, width) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        points.forEach((pt, k) => {
            const x = pt.x + nx * offset, y = pt.y + ny * offset;
            if (k === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
    },
    seededRandom() {
        this.currentSeed = (this.currentSeed * 48271) % 2147483647;
        return (this.currentSeed / 2147483647);
    },
    setSeed(seed) {
        this.initialSeed = seed || Math.floor(Math.random() * 9999999) + 1;
        this.currentSeed = this.initialSeed;
        return this.initialSeed;
    },
    findBand(bands, t) {
        for (const b of bands) if (t <= b.maxT) return b;
        return bands[bands.length - 1];
    },
    generateRegionName(isWater) {
        const landPrefixes = ['Ново', 'Старо', 'Верхо', 'Ниже', 'Красо', 'Бело', 'Чёрно', 'Зелено', 'Тихо', 'Дально'];
        const landSuffixes = ['город', 'поль', 'озёрск', 'горск', 'дол', 'брод', 'лесье', 'край', 'вин', 'бург'];
        const waterPrefixes = ['Синь', 'Глубо', 'Штиле', 'Волно', 'Прилив'];
        const waterSuffixes = ['море', 'залив', 'пролив', 'воды', 'простор'];
    
        const prefixes = isWater ? waterPrefixes : landPrefixes;
        const suffixes = isWater ? waterSuffixes : landSuffixes;
    
        const p = prefixes[Math.floor(this.utils.seededRandom() * prefixes.length)];
        const s = suffixes[Math.floor(this.utils.seededRandom() * suffixes.length)];
        return p + s;
    },
    drawCurvedLabel(ctx, text, cx, cy, angle, length, options = {}) {
        const fontSize = (options.fontSize ?? 8)  * (length * 0.013) ;
        const curveStrength = options.curveStrength ?? 0; // 0 = прямая линия, выше = сильнее дуга
        const letterSpacingScale = options.letterSpacing ?? 1.1;

        ctx.save();
        ctx.font = `bold ${fontSize}px Consolas`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = options.color ?? 'rgba(20, 15, 10, 0.85)';

        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.2;

        // ширина текста для равномерного распределения по доступной длине
        const totalTextWidth = [...text].reduce((sum, ch) => sum + ctx.measureText(ch).width * letterSpacingScale, 0);
        const usableLength = Math.min(length * 0.85, totalTextWidth * 2.2); // не растягиваем текст сильнее, чем нужно

        let cursor = -usableLength / 2;
        const dx = Math.cos(angle), dy = Math.sin(angle);
        const perpX = -dy, perpY = dx; // перпендикуляр к главной оси — для дуги

        [...text].forEach(ch => {
            const w = ctx.measureText(ch).width * letterSpacingScale;
            const t = (cursor + w / 2) / (usableLength / 2 || 1); // -1..1 вдоль линии
            const bow = curveStrength * length * 0.15 * (1 - t * t); // парабола — выгиб сильнее в центре

            const px = cx + dx * (cursor + w / 2) + perpX * bow;
            const py = cy + dy * (cursor + w / 2) + perpY * bow;
            const letterAngle = angle + t * curveStrength * 0.6; // лёгкий поворот букв по ходу дуги

            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(letterAngle);
            ctx.strokeText(ch, 0, 0);
            ctx.fillText(ch, 0, 0);
            ctx.restore();

            cursor += w;
        });

        ctx.restore();
    },
    distanceToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq < 1e-9) return Math.hypot(px - x1, py - y1);
    
        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        const projX = x1 + t * dx, projY = y1 + t * dy;
        return Math.hypot(px - projX, py - projY);
    }
}
// ═══════════════════════════════════════════════════════════
// SECTION: MAP_DECORATIONS
// Растровые иконки поверх регионов (деревья, горы, рябь и т.п.).
// Позиции считаются один раз в setup() — статичны для карты.
// Асинхронная загрузка спрайтов не блокирует создание карты.
// ═══════════════════════════════════════════════════════════
const MapDecorations = {
    loadAssets() {
        const keys = [];
        Object.keys(this.decorations.variantsPerKey).forEach(key => {
            for (let v = 1; v <= this.decorations.variantsPerKey[key]; v++) keys.push(`${key}_${v}`);
        });
        for (let v = 1; v <= this.decorations.textures.variantCount; v++) keys.push(`texture_${v}`)
        this.assets.loadBatch(keys).then((e) => {
            this.decorations.ready = true;
            if (this.terrain.regions.all.length) { this.markDirty('terrain'); this.render(); }
        });
    },
    shrinkPolygon(polygon, factor) {
        let cx = 0, cy = 0;
        polygon.forEach(([x, y]) => { cx += x; cy += y; });
        cx /= polygon.length; cy /= polygon.length;
        return polygon.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor]);
    },

    pointInPolygon(x, y, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i][0], yi = polygon[i][1];
            const xj = polygon[j][0], yj = polygon[j][1];
            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    },

    resolveIconSet(region) {
        if (region.isWater) return this.decorations.waterSets[region.biomeBand] || null;
        if (region.climateZone === 'cold' && this.decorations.snowSets[region.biomeBand]) {
            return this.decorations.snowSets[region.biomeBand];
        }
        if (region.climateZone === 'hot' && this.decorations.hotSets[region.biomeBand]) {
            return this.decorations.hotSets[region.biomeBand];
        }
        return this.decorations.sets[region.biomeBand] || null;
    },
    generatePlacements(region, polygon) {
        const set = this.decorations.resolveIconSet(region);
        if (!set) return [];
    
        const inner = this.decorations.shrinkPolygon(polygon, this.decorations.edgeMargin);
        const xs = inner.map(p => p[0]), ys = inner.map(p => p[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        if (maxX - minX < 2 || maxY - minY < 2) return [];
    
        const refDim = Math.min(maxX - minX, maxY - minY);
        const [sizePctMin, sizePctMax] = set.sizePct || this.decorations.defaultSizePct;
        const bias = region.decorBias || { dirX: 0, dirY: 0, strength: 0 };
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        const halfDiag = refDim / 2 || 1;
    
        const gapFactor = this.decorations.gapFactor;

        const count = set.count[0] + Math.floor(this.utils.seededRandom() * (set.count[1] - set.count[0] + 1));
        const placements = [];
    
        for (let n = 0; n < count; n++) {
            const candidates = [];
            for (let attempt = 0; attempt < 12 && candidates.length < 4; attempt++) {
                const x = minX + this.utils.seededRandom() * (maxX - minX);
                const y = minY + this.utils.seededRandom() * (maxY - minY);
                if (!this.decorations.pointInPolygon(x, y, inner)) continue;
    
                const sizePct = sizePctMin + this.utils.seededRandom() * (sizePctMax - sizePctMin);
                const size = refDim * sizePct;
                const half = size / 2;
    
                const insetHalf = half * 0.6;
                const corners = [[x - insetHalf, y - insetHalf], [x + insetHalf, y - insetHalf],
                                  [x - insetHalf, y + insetHalf], [x + insetHalf, y + insetHalf]];
                if (!corners.every(([px, py]) => this.decorations.pointInPolygon(px, py, inner))) continue;
                
                const tooClose = placements.some(p => {
                    const required = (p.size / 2 + size / 2) * gapFactor;
                    return Math.hypot(p.x - x, p.y - y) < required;
                });
                if (tooClose) continue;

                const nearbySegments = this.riverProximityIndex?.get(region.id);
                if (nearbySegments && nearbySegments.length) {
                    const tooCloseToRiver = nearbySegments.some(seg =>
                        this.distanceToSegment(x, y, seg.x1, seg.y1, seg.x2, seg.y2) < this.decorations.riverExclusionRadius
                    );
                    if (tooCloseToRiver) continue;
                }
                
                if (region.isTown) {
                    const distToTown = Math.hypot(x - region.x, y - region.y);
                    if (distToTown < this.decorations.townExclusionRadius) continue;
                }

                candidates.push({ x, y, size });
            }

            if (!candidates.length) continue;

            let chosen = candidates[0];
            if (bias.strength > 0 && candidates.length > 1) {
                let bestScore = -Infinity;
                candidates.forEach(c => {
                    const px = (c.x - cx) / halfDiag, py = (c.y - cy) / halfDiag;
                    const alignment = px * bias.dirX + py * bias.dirY; // -1..1
                    if (alignment > bestScore) { bestScore = alignment; chosen = c; }
                });
            } else {
                chosen = candidates[Math.floor(this.utils.seededRandom() * candidates.length)];
            }
            
            const key = set.keys[Math.floor(this.utils.seededRandom() * set.keys.length)];
            const rnd = () => this.utils.seededRandom();
            const kind = this.pixelDecor.kindByKey[key]; if (!kind) continue;
            const warmP = Math.min(1, Math.max(0, (region.temperature - 0.3) * 1.5));   // плавный тёплый градиент внутри зоны
            placements.push({ kind, x: chosen.x, y: chosen.y,
            shape: (rnd() * 2) | 0, seed: (rnd() * 4) | 0,
            shade: ((rnd() * 3) | 0) - 1, warm: rnd() < warmP ? 1 : 0,
            scale: 1,
            lod: rnd() });
    
        }
        placements.sort((a, b) => a.y - b.y);
        return placements;
    },

    assignTo(region, polygon) {
        region.icons = this.decorations.enabled ? this.decorations.generatePlacements(region, polygon) : [];
        region.textureVariant = (this.decorations.enabled )
            ? 1 + Math.floor(this.utils.seededRandom() * this.decorations.textures.variantCount)
            : null;
    },

    paint(ctx, visibleRect = null) {
        if (!this.decorations.ready || this.viewMode === 'factions' ||
            ['food', 'gold', 'production', 'manpower', 'ether'].includes(this.viewMode)) return;

        this.terrain.regions.all.forEach(region => {
            if (!region.icons || !region.icons.length) return;
            if (visibleRect && !this.bboxIntersects(region.bbox, visibleRect)) return;

            region.icons.forEach(icon => {
                console.log(icon.assetName)
                const img = this.assets.get(icon.assetName);
                if (!img) return;
                ctx.save();
                /*
                ctx.fillStyle = '#166534';
                ctx.globalAlpha = 0.5
                ctx.beginPath();
                ctx.fillRect(icon.x, icon.y, 0.5, 0.5);
                ctx.fill();*/

                ctx.translate(icon.x, icon.y);
                
                const ps = 0.4; 

                const drawPx = (dx, dy, color) => {
                    ctx.fillStyle = color;
                    ctx.fillRect(dx * ps, dy * ps, ps, ps);
                };
                 if (icon.assetName === 'tree_lone_1') {
                    const green = '#388c2d';
                    const lightgreen = '#2fa22b';
                    const darkgreen = '#20522a';
                    const brown = '#795548';
                    drawPx(-1, -2, lightgreen); drawPx(0, -2, green); drawPx(1, -2, darkgreen);
                    drawPx(-1, -1, lightgreen); drawPx(0, -1, green); drawPx(1, -1, darkgreen);
                    drawPx(0, 0, brown);
                } else
                if(icon.assetName.indexOf('tree') !== -1){
                    const green = '#388c2d'; // Листва
                    const lightgreen = '#2fa22b'; // Листва
                    const darkgreen = '#20522a'; // Листва
                    const brown = '#795548'; // Ствол
        
                    drawPx(0, -3, green); 
                    drawPx(-1, -2, lightgreen); drawPx(0, -2, green); drawPx(1, -2, darkgreen);
                    drawPx(-1, -1, lightgreen); drawPx(0, -1, green); drawPx(1, -1, darkgreen);
                    
                    drawPx(0, 0, brown);
                    drawPx(0, 1, brown);
                }
                // Цвета для дерева
                if(icon.assetName.indexOf('grass_tuft_1') !== -1){
                    const green = '#388c2d';
                    const darkgreen = '#20522a';
                
                    // Маленький низкий пучок травы
                    drawPx(-1, 0, darkgreen);
                    drawPx(0, -1, green);
                    drawPx(1, 0, darkgreen);
                } else
                // Цвета для дерева
                if(icon.assetName.indexOf('grass') !== -1){
                    const grassLight = '#55a630';
                    const grassDark = '#2b9348';

                    // Пучок травы
                    drawPx(-1, 0, grassDark);
                    drawPx(0, -1, grassLight);
                    drawPx(0, 0, grassDark);
                    drawPx(1, 0, grassLight);
                } 
                if(icon.assetName.indexOf('mountain') !== -1){
                    // Большая и сложная гора
                    // Используем больше оттенков серого для сложного рельефа
                    const snow = '#ffffff';
                    const stoneTop = '#e0e0e0'; // Светлый камень под снегом
                    const stoneMid = '#bdbdbd'; // Основной серый
                    const stoneDark = '#9e9e9e'; // Тень
                    const stoneDeep = '#757575'; // Глубокая тень
                    const rockBase = '#616161'; // Основание
                    const rockDark = '#424242'; // Самый темный камень внизу

                    // --- ВЫСОКИЙ ПИК (Пиксели по оси Y идут вверх от -6 до 0) ---

                    // Ряд 1: Вершина (снег)
                    drawPx(0, -6, snow);

                    // Ряд 2: Верхний склон
                    drawPx(-1, -5, stoneTop); drawPx(0, -5, snow); drawPx(1, -5, stoneMid);

                    // Ряд 3: Снежный карниз и тень
                    drawPx(-2, -4, stoneTop); drawPx(-1, -4, stoneTop); drawPx(0, -4, snow);
                    drawPx(1, -4, stoneDark); drawPx(2, -4, stoneDeep);

                    // Ряд 4: Тело пика (расширяется)
                    drawPx(-3, -3, stoneMid); drawPx(-2, -3, stoneMid); drawPx(-1, -3, stoneMid);
                    drawPx(0, -3, stoneDark); drawPx(1, -3, stoneDark);
                    drawPx(2, -3, stoneDeep); drawPx(3, -3, stoneDeep);

                    // Ряд 5: Переход к основанию (сложная текстура)
                    drawPx(-3, -2, stoneMid); drawPx(-2, -2, stoneDark); drawPx(-1, -2, stoneDeep);
                    drawPx(0, -2, stoneDeep); drawPx(1, -2, stoneDeep);
                    drawPx(2, -2, rockBase); drawPx(3, -2, rockBase);

                    // --- МАССИВНОЕ ОСНОВАНИЕ (Y = -1 и Y = 0) ---

                    // Ряд 6: Верх основания (широкий)
                    drawPx(-4, -1, stoneDeep); drawPx(-3, -1, rockBase); drawPx(-2, -1, rockBase);
                    drawPx(-1, -1, rockBase); drawPx(0, -1, rockDark); drawPx(1, -1, rockDark);
                    drawPx(2, -1, rockDark); drawPx(3, -1, rockDark); drawPx(4, -1, rockBase);

                    // Ряд 7: Самый низ (полный блок)
                    drawPx(-4, 0, rockDark); drawPx(-3, 0, rockDark); drawPx(-2, 0, rockDark);
                    drawPx(-1, 0, rockBase); drawPx(0, 0, rockBase); drawPx(1, 0, rockBase);
                    drawPx(2, 0, rockBase); drawPx(3, 0, rockDark); drawPx(4, 0, rockDark);
                }

                /*
                ctx.translate(icon.x, icon.y);
                ctx.rotate(icon.rotation);
                ctx.drawImage(img, -icon.size / 2, -icon.size / 2, icon.size, icon.size);*/
                ctx.restore();
            });
        });
    },
    paintTextures(ctx, visibleRect = null) {
        return;
        if (!this.decorations.ready) return;
        this.terrain.regions.all.forEach((region, i) => {
            if (!region.textureVariant) return;
            if (visibleRect && !this.bboxIntersects(region.bbox, visibleRect)) return;
    
            const img = this.assets.get(`texture_${region.textureVariant}`);
            if (!img) return;
    
            const polygon = this.mapVoronoi.cellPolygon(i);
            if (!polygon) return;
    
            const { minX, minY, maxX, maxY } = region.bbox;
            const boxW = (maxX - minX); 
            const boxH = (maxY - minY);
            if (boxW <= 0 || boxH <= 0) return;
    
            const side = Math.max(boxW, boxH);
            const cx = minX + boxW / 2, cy = minY + boxH / 2;
            const drawX = cx - side / 2, drawY = cy - side / 2;
    
            ctx.save();
            this.drawRegionPath(ctx, polygon);
            ctx.clip();
    
            ctx.globalAlpha = this.decorations.textures.alpha;
            ctx.drawImage(img, drawX-4, drawY-4, side+8, side+8); 
    
            ctx.restore();
        });
    },
    computeBias(region, regions, neighborsList) {
        const affinity = this.decorations.biomeAffinity[region.biomeBand];
        if (!affinity) return { dirX: 0, dirY: 0, strength: 0 };
    
        let sumX = 0, sumY = 0, totalWeight = 0;
        (neighborsList[region.id] || []).forEach(nbId => {
            const nb = regions[nbId];
            const weight = affinity[nb.biomeBand] || 0;
            if (weight <= 0) return;
            sumX += (nb.x - region.x) * weight;
            sumY += (nb.y - region.y) * weight;
            totalWeight += weight;
        });
    
        if (totalWeight === 0) return { dirX: 0, dirY: 0, strength: 0 };
    
        const len = Math.hypot(sumX, sumY) || 1;
        return {
            dirX: sumX / len,
            dirY: sumY / len,
            strength: Math.min(1, totalWeight / 3), // насколько выражено смещение — больше похожих соседей = сильнее
        };
    },
};

const MapArmies = {
    computeReachable(army) {
        const visited = new Map();
        const startAP = army.actionPoints;
        if (startAP <= 0) return visited;
    
        visited.set(army.regionId, startAP);
        const queue = [{ id: army.regionId, ap: startAP }];
        let qi = 0;
    
        while (qi < queue.length) {
            const { id, ap } = queue[qi++];
            const neighbors = this.regionNeighbors?.[id] || [];
    
            for (const nb of neighbors) {
                const region = this.terrain.regions.all[nb];
                if (!region || region.isWater) continue;
    
                if (this.rivers.isBlocking(id, nb)) continue; 
    
                const occupiedByEnemy = this.armiesProvider &&
                    this.armiesProvider().some(a => a.regionId === nb && a.factionId !== army.factionId);
                if (occupiedByEnemy) continue;
    
                const isAnotherFaction = region.ownerId !== null && region.ownerId !== army.factionId
                if (isAnotherFaction) continue;

                const cost = this.armies.movementCost[region.biomeBand] ?? 1;
                const remaining = ap - cost;
                if (remaining < 0) continue;
    
                const already = visited.get(nb);
                if (already !== undefined && already >= remaining) continue;
    
                visited.set(nb, remaining);
                queue.push({ id: nb, ap: remaining, region });
            }
        }
        visited.delete(army.regionId);
        return visited;
    },
    select(armyId) {
        if (!this.armiesProvider) return;
        const army = this.armiesProvider().find(a => a.id === armyId);
        if (!army) return;
    
        this.selection.armyId = armyId;
        const reachable = this.armies.computeReachable(army);
        this.selection.reachableSet = new Set(reachable.keys());
    
        if (this.selection.onArmySelect) this.selection.onArmySelect(army, [...this.selection.reachableSet]);
        this.scheduleRender();
    },
    renderReachableArea(ctx) {
        if (!this.selection.reachableSet || !this.selection.reachableSet.size) return;
    
        const reachable = this.selection.reachableSet;
        const borderWidth = 0.5;
        const fillAlpha = 0.28;
    
        ctx.save();
        ctx.globalAlpha = fillAlpha;
        ctx.fillStyle = '#6fcf39';
        reachable.forEach(regionId => {
            const polygon = this.mapVoronoi.cellPolygon(regionId);
            if (!polygon) return;
            this.drawRegionPath(ctx, polygon);
            ctx.fill();
        });
        ctx.restore();
    
        ctx.save();
        ctx.strokeStyle = '#6fcf39';
        ctx.lineWidth = borderWidth;
        ctx.lineJoin = 'round';
        this.edgeMap.forEach(edge => {
            if (edge.regionIds.length < 2) return;
            const [a, b] = edge.regionIds;
            const aIn = reachable.has(a), bIn = reachable.has(b);
            if (aIn === bIn) return; // либо обе стороны внутри зоны, либо обе снаружи — граница тут не нужна
    
            const segments = this.getNoisyLineSegments(edge.p1[0], edge.p1[1], edge.p2[0], edge.p2[1]);
            ctx.beginPath();
            segments.forEach((pt, k) => k === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
            ctx.stroke();
        });
        ctx.restore();
    },

    render(ctx) {
        if (!this.armiesProvider) return;
        const armies = this.armiesProvider();
        const spriteSize = 17
        const plateHeight = 1
        const plateWidth = 1.3

        const visible = this.fogEnabled && this.playerFactionId !== null && this.playerFactionId !== undefined
        ? this.getCachedVisibility() : null;

        armies.forEach(army => {
            const region = this.terrain.regions.all[army.regionId];
            if (!region) return;

            if (visible && !visible[army.regionId] && army.factionId !== this.playerFactionId) return; 

            let drawX = region.x, drawY = region.y;

            const anim = this.armies.animations.all.get(army.id);
            if (anim) {
                const t = Math.min(1, (performance.now() - anim.startTime) / anim.duration);
                const eased = 1 - Math.pow(1 - t, 2);
                drawX = anim.fromX + (anim.toX - anim.fromX) * eased;
                drawY = anim.fromY + (anim.toY - anim.fromY) * eased;
            }

            const faction = this.factions.list?.[army.factionId];
            const color = faction ? faction.color : '#999999';
            const img = this.armies.assets.get(army);

            ctx.save();
            const spriteBottomY = drawY - plateHeight * 0.5+4;
            const spriteTopY = spriteBottomY - spriteSize;

            if (img) {
                ctx.drawImage(img, drawX - spriteSize / 2, spriteTopY, spriteSize, spriteSize);
            } else {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(drawX, spriteTopY + spriteSize / 2, spriteSize / 2.5, 0, Math.PI * 2);
                ctx.fill();
            }
            // табличка с числом под юнитом — цвет фракции, как рамка/фон
            /*
            const plateY = spriteBottomY;
            ctx.fillStyle = color;
            ctx.fillRect(drawX - plateWidth / 2, plateY, plateWidth, plateHeight);
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 0.4;
            ctx.strokeRect(drawX - plateWidth / 2, plateY, plateWidth, plateHeight);
    
            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${plateHeight * 0.75}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(army.strength, drawX, plateY + plateHeight / 2 + 0.3);
  
            // подсветка выбранной армии — рамка вокруг всей связки спрайт+табличка
            if (this.selection.armyId === army.id) {
                ctx.strokeStyle = this.selection.color;
                ctx.lineWidth = 1;
                ctx.strokeRect(
                    drawX - plateWidth / 2, plateY, plateWidth, plateHeight
                );
            }
  */
            ctx.restore();
        });
    },
    moveAnimation(armyId, fromRegionId, toRegionId) {
        const fromRegion = this.terrain.regions.all[fromRegionId];
        const toRegion = this.terrain.regions.all[toRegionId];
        if (!fromRegion || !toRegion) return;
    
        this.armies.animations.all.set(armyId, {
            fromX: fromRegion.x, fromY: fromRegion.y,
            toX: toRegion.x, toY: toRegion.y,
            startTime: performance.now(),
            duration: this.armies.animations.duration,
        });
    
        this.armies.animations.runLoop();
    },
    runAnimationLoop() {
        if (this._armyAnimLoopActive) { console.log('anim loop already active, skip'); return; }
        this._armyAnimLoopActive = true;
        const step = () => {
            const now = performance.now();
            let anyActive = false;
            this.armies.animations.all.forEach((anim, armyId) => {
                const t = (now - anim.startTime) / anim.duration;
                if (t >= 1) { this.armies.animations.all.delete(armyId); }
                else { anyActive = true; }
            });
            this.render();
            if (anyActive) requestAnimationFrame(step);
            else { this._armyAnimLoopActive = false; console.log('anim loop STOPPED'); }
        };
        requestAnimationFrame(step);
    },
    buildArmyAssetKey(faction, army) {
        const rank = army.rank || 1;
        const townSuffix = this.terrain.regions.all[army.regionId]?.isTown ? '-town' : '';
        return `army-${faction.colorId}-${faction.culture.toLowerCase()}-${rank}-${army.assetVariant}${townSuffix}`;
    },
    getArmyAsset(army) {
        const faction = this.factions.list?.[army.factionId];
        if (!faction) return null;
        const key = this.armies.assets.buildKey(faction, army);
        return this.assets.get(key);
    },
    renderOccupationHatching(ctx, visibleRect = null) {
        for (let i = 0; i < this.terrain.regions.all.length; i++) {
            const region = this.terrain.regions.all[i];
            if (region.occupiedBy === null) continue;
            if (visibleRect && !this.bboxIntersects(region.bbox, visibleRect)) continue;
    
            const polygon = this.mapVoronoi.cellPolygon(i);
            if (!polygon) continue;
    
            const faction = this.factions.list?.[region.occupiedBy];
            const color = faction ? faction.color : '#ff0000';
    
            ctx.save();
            this.drawRegionPath(ctx, polygon);
            ctx.clip();
    
            const { minX, minY, maxX, maxY } = region.bbox;
            const spacing = 2.5;
            ctx.strokeStyle = color;
            ctx.lineWidth = 0.6;
            ctx.globalAlpha = 0.6;
            const diag = (maxX - minX) + (maxY - minY);
            for (let offset = -diag; offset < diag; offset += spacing) {
                ctx.beginPath();
                ctx.moveTo(minX + offset, minY);
                ctx.lineTo(minX + offset + (maxY - minY), maxY);
                ctx.stroke();
            }
            ctx.restore();
        }
    }
}

const MapSelection = {
    clearSelection() {
        if (this.selection.regionId === null && this.selection.armyId === null) return;
        this.selection.regionId = null;
        this.selection.armyId = null;
        this.selection.reachableSet = null;
        this.scheduleRender();
    },
    renderSelection(ctx) {
        if (this.selection.regionId === null) return;
        const region = this.terrain.regions.all[this.selection.regionId];
        if (!region) return;
    
        const polygon = this.mapVoronoi.cellPolygon(region.id);
        if (!polygon) return;
    
        ctx.save();
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = this.selection.color;
        ctx.shadowColor = this.selection.color;
        ctx.shadowBlur = 2;
        this.drawRegionPath(ctx, polygon);
        ctx.stroke();
        ctx.restore();
    }
}
const MapRivers = {
    generate() {
        if (!this.rivers.enabled || !this.vertexGraph) { this.rivers.segments = []; this.rivers.ready = true; return; }
    
        const sourceKeys = this.rivers.findSourceCandidates(this.vertexGraph, this.rivers.minSourceLandDistance);
        if (!sourceKeys.length) { this.rivers.segments = []; this.rivers.ready = true; return; }
    
        const rivers = [];
        let attempts = 0;
        while (rivers.length < this.rivers.count && attempts < this.rivers.count * 10) {
            attempts++;
            const startKey = sourceKeys[Math.floor(this.utils.seededRandom() * sourceKeys.length)];
            const path = this.rivers.tracePath(this.vertexGraph, startKey, this.rivers.maxPoints);
    
            if (path.length >= this.rivers.minPoints) {
                rivers.push(path);
                if (path.length >= this.rivers.branchMinLength && this.utils.seededRandom() < this.rivers.branchChance) {
                    const branchStartIdx = 1 + Math.floor(this.utils.seededRandom() * (path.length - 2));
                    const branch = this.rivers.tracePath(this.vertexGraph, path[branchStartIdx], Math.ceil(this.rivers.maxPoints * 0.5));
                    if (branch.length >= this.rivers.minPoints) rivers.push(branch);
                }
            }
        }
    
        this.rivers.segments = this.rivers.createPolylines(rivers);
        this.rivers.ready = true;
    },
    
    createPolylines(paths) {
        const riverBlockedPairs = new Set();
        const bridges = [];

        const polylines = paths.map(path => {
            const points = [];
            let stepsSinceLastBridge = this.rivers.bridgeMinGap; // разрешаем мост сразу в начале при желании

            for (let i = 0; i < path.length - 1; i++) {
                const from = this.vertexGraph.get(path[i]);
                const edge = from.edges.get(path[i + 1]);
                if (!edge) continue;

                const to = this.vertexGraph.get(path[i + 1]);
                const sharedRegions = [...from.regionIds].filter(id => to.regionIds.has(id));

                if (sharedRegions.length >= 2) {
                    for (let a = 0; a < sharedRegions.length; a++) {
                        for (let b = a + 1; b < sharedRegions.length; b++) {
                            const x = sharedRegions[a], y = sharedRegions[b];
                            riverBlockedPairs.add(x < y ? `${x}-${y}` : `${y}-${x}`);
                        }
                    }

                    // Отбор моста для ЭТОГО сегмента (шага пути между двумя точками схождения)
                    stepsSinceLastBridge++;
                    const canPlaceBridge = stepsSinceLastBridge > this.rivers.bridgeMinGap;
                    if (canPlaceBridge && this.utils.seededRandom() < this.rivers.bridgeChance && sharedRegions.length >= 2) {
                        const midX = (edge.p1[0] + edge.p2[0]) / 2;
                        const midY = (edge.p1[1] + edge.p2[1]) / 2;
                        bridges.push({ regionA: sharedRegions[0], regionB: sharedRegions[1], x: midX, y: midY });
                        stepsSinceLastBridge = 0;
                    }
                }

                const segPoints = this.getNoisyLineSegments(edge.p1[0], edge.p1[1], edge.p2[0], edge.p2[1]);
                const startIdx = points.length ? 1 : 0;
                for (let k = startIdx; k < segPoints.length; k++) points.push(segPoints[k]);
            }
            return points;
        }).filter(p => p.length >= 2);

        this.rivers.blockedPairs = riverBlockedPairs;
        this.rivers.bridges = bridges;
        return polylines;
    },
    paint(ctx, visibleRect = null) {
        if (!this.rivers.ready || !this.rivers.segments.length) return;
        this.rivers.segments.forEach(points => {
            ctx.strokeStyle = this.rivers.color;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
    
            for (let i = 0; i < points.length - 1; i++) {
                const t = i / (points.length - 1);
                ctx.lineWidth = this.rivers.widthMin + (this.rivers.widthMax - this.rivers.widthMin) * t;
                ctx.beginPath();
                ctx.moveTo(points[i].x, points[i].y);
                ctx.lineTo(points[i + 
                    1].x, points[i + 1].y);
                ctx.stroke();
            }
        });
    },
    paintBridges(ctx, visibleRect = null) {
        if (!this.rivers.bridges || !this.rivers.bridges.length) return;
    
        this.rivers.bridges.forEach(bridge => {
            const regionA = this.terrain.regions.all[bridge.regionA];
            const regionB = this.terrain.regions.all[bridge.regionB];
            if (!regionA || !regionB) return;
    
            if (visibleRect) {
                const midX = (regionA.x + regionB.x) / 2, midY = (regionA.y + regionB.y) / 2;
                if (midX < visibleRect.minX || midX > visibleRect.maxX ||
                    midY < visibleRect.minY || midY > visibleRect.maxY) return;
            }
    
            // направление строго от центра региона A к центру региона B
            const dx = regionB.x - regionA.x, dy = regionB.y - regionA.y;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len, uy = dy / len;
    
            // короткий отрезок в СЕРЕДИНЕ этой линии — покрывает только толщину русла, а не всю дистанцию между центрами
            const midX = (regionA.x + regionB.x) / 2, midY = (regionA.y + regionB.y) / 2;
            const halfLen = this.rivers.bridgeLength// / 2;
    
            const x1 = midX - ux * halfLen, y1 = midY - uy * halfLen;
            const x2 = midX + ux * halfLen, y2 = midY + uy * halfLen;
   
            ctx.save();
             
            ctx.strokeStyle = '#5a4a30';
            ctx.lineWidth = this.rivers.bridgeWidth;
            ctx.lineCap = 'butt';
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            
            ctx.strokeStyle = '#A1AD62';
            ctx.lineWidth = this.rivers.bridgeWidth * 0.85;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            ctx.restore();
        });
    },
    buildVertexGraph(regions, voronoi) {
        const vertexKey = (x, y) => `${Math.round(x * 20)},${Math.round(y * 20)}`; 
        const vertices = new Map();
    
        for (let i = 0; i < regions.length; i++) {
            const polygon = voronoi.cellPolygon(i);
            if (!polygon) continue;
    
            for (let j = 0; j < polygon.length - 1; j++) {
                const [x1, y1] = polygon[j], [x2, y2] = polygon[j + 1];
                const k1 = vertexKey(x1, y1), k2 = vertexKey(x2, y2);
    
                if (!vertices.has(k1)) vertices.set(k1, { x: x1, y: y1, regionIds: new Set(), edges: new Map() });
                if (!vertices.has(k2)) vertices.set(k2, { x: x2, y: y2, regionIds: new Set(), edges: new Map() });
    
                vertices.get(k1).regionIds.add(i);
                vertices.get(k2).regionIds.add(i);
    
                vertices.get(k1).edges.set(k2, { toKey: k2, p1: [x1, y1], p2: [x2, y2] });
                vertices.get(k2).edges.set(k1, { toKey: k1, p1: [x2, y2], p2: [x1, y1] });
            }
        }
    
        return vertices;
    },
    annotateVertices(vertices, regions) {
        vertices.forEach(v => {
            v.regionArray = [...v.regionIds];
            v.hasWater = v.regionArray.some(id => regions[id].isWater);
            v.landCount = v.regionArray.filter(id => !regions[id].isWater).length;
            v.minDistToWater = Math.min(...v.regionArray.map(id => regions[id].distanceToWater ?? 99));
        });
    },
    findMouthCandidates(vertices) {
        const mouths = [];
        vertices.forEach((v, key) => {
            if (v.regionArray.length < 3) return;
            if (!v.hasWater) return;
            if (v.landCount < 2) return;
            mouths.push(key);
        });
        return mouths;
    },
    findSourceCandidates(vertices, minLandDistance) {
        const sources = [];
        vertices.forEach((v, key) => {
            if (v.regionArray.length < 3) return;
            if (v.hasWater) return; // исток должен быть вглубь суши
            if (v.minDistToWater < minLandDistance) return;
            sources.push(key);
        });
        return sources;
    },
    tracePath(vertices, startKey, maxPoints) {
        const path = [startKey];
        let current = startKey;
        const visited = new Set([current]);
    
        while (path.length < maxPoints) {
            const v = vertices.get(current);
            if (!v) break;
            if (v.hasWater) break; 
            const next = this.rivers._findNextConfluence(vertices, current, visited);
            if (!next) break;
    
            path.push(next);
            visited.add(next);
            current = next;
        }
        return path;
    },
    _findNextConfluence(vertices, fromKey, visited) {
        const from = vertices.get(fromKey);
        if (!from) return null;
    
        const candidates = [];
        from.edges.forEach((edge, toKey) => {
            if (visited.has(toKey)) return;
            const to = vertices.get(toKey);
            if (!to || to.regionArray.length < 3) return;
            candidates.push(toKey);
        });
    
        if (!candidates.length) return null;
    
        let best = candidates[0], bestDist = vertices.get(candidates[0]).minDistToWater;
        candidates.forEach(k => {
            const d = vertices.get(k).minDistToWater;
            if (d < bestDist) { bestDist = d; best = k; }
        });
        return best;
    },
    isBlocking(regionIdA, regionIdB) {
        if (!this.rivers.blockedPairs || !this.rivers.blockedPairs.size) return false;
        const key = regionIdA < regionIdB ? `${regionIdA}-${regionIdB}` : `${regionIdB}-${regionIdA}`;
        if (!this.rivers.blockedPairs.has(key)) return false;

        return !this.rivers.hasBridge(regionIdA, regionIdB);
    },
    hasBridge(regionA, regionB) {
        return this.rivers.bridges.some(b =>
            (b.regionA === regionA && b.regionB === regionB) || (b.regionA === regionB && b.regionB === regionA)
        );
    },
    createProximityIndex() {
        const index = new Map();
    
        this.rivers.segments.forEach(points => {
            for (let i = 0; i < points.length - 1; i++) {
                const seg = { x1: points[i].x, y1: points[i].y, x2: points[i+1].x, y2: points[i+1].y };
                const minX = Math.min(seg.x1, seg.x2), maxX = Math.max(seg.x1, seg.x2);
                const minY = Math.min(seg.y1, seg.y2), maxY = Math.max(seg.y1, seg.y2);
    
                this.terrain.regions.all.forEach(region => {
                    if (region.isWater) return;
                    const pad = this.decorations.riverExclusionRadius + 5;
                    const overlaps = region.bbox.maxX >= minX - pad && region.bbox.minX <= maxX + pad &&
                                      region.bbox.maxY >= minY - pad && region.bbox.minY <= maxY + pad;
                    if (!overlaps) return;
    
                    if (!index.has(region.id)) index.set(region.id, []);
                    index.get(region.id).push(seg);
                });
            }
        });
        return index;
    }
};

const MapTowns = {
    loadAssets() {
        const keys = []
        const baseKeys = [
            ...Object.values(this.towns.assets.keysByBiome),
            ...Object.values(this.towns.assets.keysByBiomeSnow),
            ...Object.values(this.towns.assets.keysByBiomeHot),
        ];
        baseKeys.forEach(baseKey => {
            for (let v = 1; v <= this.towns.assets.variantsPerKey; v++) keys.push(`${baseKey}_${v}`);
        });
        this.assets.loadBatch(keys).then((e) => {
            this.towns.assets.ready = true;
            this._invalidateDetailCache();
            this.markDirty('terrain');
            this.render();
        });
    },
    buildKey(region) {
        if (region.climateZone === 'cold' && this.towns.assets.keysByBiomeSnow[region.biomeBand]) {
            return this.towns.assets.keysByBiomeSnow[region.biomeBand];
        }
        if (region.climateZone === 'hot' && this.towns.assets.keysByBiomeHot[region.biomeBand]) {
            return this.towns.assets.keysByBiomeHot[region.biomeBand];
        }
        return this.towns.assets.keysByBiome[region.biomeBand] || 'town_plains';
    },
    render(ctx, visibleRect = null) {
        if (!this.towns.assets.ready) return;
        this.terrain.regions.all.forEach(region => {
            if (!region.isTown) return;
            if (visibleRect && !this.bboxIntersects(region.bbox, visibleRect)) return; 
        
            const size = 11;
            const img = this.assets.get(region.townAssetKey);
            if (img) ctx.drawImage(img, region.x - size / 2, region.y - size + 4, size, size);
    
            ctx.save();
            ctx.font = `bold 2.7px serif`;
            ctx.textAlign = 'center';
            ctx.fillStyle = '#2a2015';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 0.4;
            let townName = region.name
            if (region.city) {
                townName = '👑 '+townName;
            }
            ctx.strokeText(townName, region.x, region.y + 4.5);
            ctx.fillText(townName, region.x, region.y + 4.5);
            ctx.restore();
        });
    }
}

const MapCultures = {
    create(region, poles) {
        const nx = region.x / this.width, ny = region.y / this.height;
    
        const weights = {};
        let total = 0;
        this.cultureIds.forEach(id => {
            const pole = poles[id];
            const dist = Math.hypot(nx - pole.x, ny - pole.y);
            const weight = Math.exp(-dist * this.cultureClusterSharpness);
            weights[id] = weight;
            total += weight;
        });
        const noise = () => 1 + (this.utils.seededRandom() - 0.5) * 0.3;
    
        const culture = {};
        let noisyTotal = 0;
        this.cultureIds.forEach(id => {
            const v = Math.max(0.001, (weights[id] / total) * noise());
            culture[id] = v;
            noisyTotal += v;
        });
        this.cultureIds.forEach(id => { culture[id] /= noisyTotal; });
    
        return culture;
    },
    createPoles() {
        const jitter = () => (this.utils.seededRandom() - 0.5) * 0.15;
        return {
            BLUE:   { x: 0.25 + jitter(), y: 0.15 + jitter() },
            BLACK:  { x: 0.45 + jitter(), y: 0.15 + jitter() },
            YELLOW: { x: 0.35 + jitter(), y: 0.85 + jitter() },
            WHITE:  { x: 0.8 + jitter(), y: 0.4 + jitter() }, 
            GREEN:  { x: 0.1 + jitter(), y: 0.5 + jitter() },
            RED:    { x: 0.5 + jitter(), y: 0.5 + jitter() },
            PURPLE: { x: 0.7 + jitter(), y: 0.6 + jitter() },
        };
    },
    applyAssimilation() {
        const assimilationRate = this.cultureAssimilationRate ?? 0.03;
    
        this.terrain.regions.all.forEach(region => {
            if (region.isWater || !region.culture) return;
            if (region.ownerId === null || region.ownerId === undefined) return; // нейтральные регионы не ассимилируются
    
            const faction = this.factions.list?.[region.ownerId];
            if (!faction || !faction.culture) return;
    
            const ownerCulture = faction.culture;
            const currentShare = region.culture[ownerCulture];
            const growth = (1 - currentShare) * assimilationRate; // чем меньше доля, тем медленнее в абсолюте, типичная логистическая динамика
    
            region.culture[ownerCulture] += growth;
    
            // пропорционально уменьшаем остальные культуры, чтобы сумма осталась 1.0
            const othersTotal = 1 - currentShare;
            if (othersTotal > 0) {
                const shrinkFactor = (othersTotal - growth) / othersTotal;
                this.cultureIds.forEach(id => {
                    if (id === ownerCulture) return;
                    region.culture[id] *= shrinkFactor;
                });
            }
        });
    },
    getDominantOfRegion(region) {
        if (!region.culture) return null;
        let best = null, bestShare = -1;
        Object.entries(region.culture).forEach(([id, share]) => {
            if (share > bestShare) { bestShare = share; best = id; }
        });
        return best;
    }
}

const MapPerf = {
    frameStart() {
        if (!this.perf.enabled) return;
        const now = performance.now();
        if (this.perf.lastFrameStart !== null) {
            const delta = now - this.perf.lastFrameStart;
            this.perf.frameTimes.push(delta);
            if (this.perf.frameTimes.length > this.perf.frameWindow) this.perf.frameTimes.shift();
        }
        this.perf.lastFrameStart = now;
    },
    
    markStart(stage) {
        if (!this.perf.enabled) return;
        this.perf.marks[stage] = performance.now();
    },
    
    markEnd(stage) {
        if (!this.perf.enabled) return;
        const start = this.perf.marks[stage];
        if (start === undefined) return;
        this.perf.lastStageTimings[stage] = performance.now() - start;
    },
    
    getStats() {
        const times = this.perf.frameTimes;
        if (!times.length) return { fps: 0, avgMs: 0, maxMs: 0 };
    
        const avgMs = times.reduce((a, b) => a + b, 0) / times.length;
        const maxMs = Math.max(...times);
        const fps = avgMs > 0 ? Math.round(1000 / avgMs) : 0;
        return { fps, avgMs: avgMs.toFixed(1), maxMs: maxMs.toFixed(1) };
    },

    initOverlay() {
        const el = document.createElement('div');
        el.style.cssText = `
            position: fixed; top: 8px; left: 8px; z-index: 9999;
            background: rgba(0,0,0,0.75); color: #0f0; font: 11px monospace;
            padding: 6px 10px; border-radius: 6px; white-space: pre; pointer-events: none;
        `;
        document.body.appendChild(el);
        this.perf.overlay = el;
    },
    
    updateOverlay() {
        if (!this.perf.enabled || !this.perf.overlay) return;
    
        const stats = this.perf.getStats();
        const stages = Object.entries(this.perf.lastStageTimings)
            .sort((a, b) => b[1] - a[1])
            .map(([name, ms]) => `${name.padEnd(16)} ${ms.toFixed(2)}ms`)
            .join('\n');
    
        this.perf.overlay.textContent =
            `FPS: ${stats.fps}  avg: ${stats.avgMs}ms  max: ${stats.maxMs}ms\n` +
            `viewLevel: ${this.viewLevel}\n` +
            `--- stages (last frame) ---\n${stages}`;
    }
}

const MapPixelDecor = {
    data: {
      patterns: {
        oak: [[
            "...ll...",
            "...lll..",
            ".llLlLd.",
            ".LLLLLd.",
            ".LLdLdd.",
            "..dddd..",
            "...TT...",
            "...TT..."
          ]],
          pine: [[
            "....l...",
            "...lLL..",
            "..lLLd..",
            "..lLLd..",
            ".llLLLd.",
            ".lLLLLd.",
            ".LLLLdd.",
            "...TT..."
          ]],
          palm: [[
            "l..l..L.",
            ".l.L.L..",
            "..lTLd..",
            "...TT...",
            "...TT...",
            "...Tt...",
            "...Tt...",
            "........"
          ]],
          bare: [[
            ".t...t..",
            "..t.t...",
            "...T....",
            "..tTTt..",
            "...TT...",
            "...TT...",
            "...TT...",
            "........"
          ]],
          grass: [[
            ".l.l...L",
            "ll.l..LL",
            ".L..D.L.",
          ]],
          cactus: [[
            "....G....",
            "..G.G.G..",
            "G.GGG.GGG",
            "GGGGGGGGG",
            "..GGGGG..",
            "....G....",
            "....G...."
          ]],
          rock: [[
            '.rRR.', 'rRRkk', 'RkkkR'
          ]],
          mountain: [[
              ".......................kk...................",
          "......................kkRRkk................",
          ".....................kkRRRRkk...............",
          ".........kk.........kkRRrrRRkk..............",
          "........kkRRkk.....kkRRrrggRRkk.............",
          ".......kkRRRRkk...kkRRrrggKKggRRkk..........",
          ".....kkRRRRRRkk..kkRRrrggKKKKggRRkk.........",
          "....kkRRrrggRRkkRRrrggKKKKKKggRRkk..........",
          "...kkRRrrggKKggRRkRRrrggKKkkKKggRRkk........",
          "..kkRRrrggKKKKggRRkRRrrggkRggkKKggRRkk......",
          ".kkRRrrggKKKKKKggRRkRRrrggkRRRggkKKggRRkk...",
          "kkRRrrggKKKKKKKKggRRkRRrrggkRRRRRggkKKggRRkk",
          "kRRrrggKKKKKKKKKKggRRkRRrrggkkrrggRRkKKggRRr",
          "RRrrggKKkkKKkkKKggRRkRRrrggxxxxggRRkKKggRrrr",
          "RrrggkRggkRRkRggkKKggRRkRRrggggggRRkKKggrrrr",
          "rrggkRRRggkRRkRRRggkKKggRRkRRrrrrrrggRrrrrrr",
          "ggkRRRRRggkRRkRRRRRggkKKggRRrrrrrrrrrrrrrrrr",
          "kRRRRRRRRRggkRRRRRRRggkKKgrrrrrrrrrrrrrrrrrr",
          "RRRRrrrrrRRggkRRRRRRRggkgrrrrrrrrrrrrrrrrrrr",
          "RRrrrrrrrrrRRggkRRrrrrrgrrrrrrrrrrrrrrrrr...",
          "rrrrrrrrrrrrrRRgggrrrrrrrrrrrrrrrrpp........",
          "rrrrrrrrrrrrrrrRRrrrrrrrrrrrrrrrpp..........",
          "rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrpp............",
          "............................pp.............."
          ]],
      },
      foliage: {
        temperate: { 
            SPRING: ['#a3c75c', '#85b04a', '#608533', '#405c21'], 
            SUMMER: ['#86a84d', '#638c35', '#456623', '#2c4215'], 
            AUTUMN: ['#d6b052', '#b38634', '#8c6020', '#5e3f12'], 
            WINTER: ['#c4d1cc', '#9eb0a8', '#73877e', '#4c5c55'] 
          },
          cold: { 
            SPRING: ['#8ab399', '#638f73', '#426650', '#2a4233'], 
            SUMMER: ['#69947a', '#477057', '#304f3b', '#1c3024'], 
            AUTUMN: ['#a8bd78', '#829953', '#5c6e38', '#3b4723'], 
            WINTER: ['#f2f5f7', '#c5d1d9', '#91a4b0', '#63737d'] 
          },
          hot: { 
            SPRING: ['#b3c75c', '#8fa838', '#667a23', '#425215'], 
            SUMMER: ['#a3b84a', '#7d942e', '#596b1f', '#364210'], 
            AUTUMN: ['#c7ab52', '#a38431', '#7a601e', '#4f3d10'], 
            WINTER: ['#a8c75c', '#8fa838', '#667a23', '#425215'] 
          },
      },
      wood: { 
        temperate: ['#6b5344', '#3d2e26'], 
        cold: ['#524842', '#2e2723'], 
        hot: ['#8c6d4f', '#5c4530'] 
      },
      stone: { 
        temperate: ['45618a', '#6d89a4', '#89b2c4'], 
        cold: ['#cbd4dc', '#7e8f9c', '#46525c'], 
        hot: ['#d6c2a8', '#9e896f', '#665543'] 
      },
      kindByKey: { tree_lone:'tree', tree_cluster:'tree', tree_snow:'tree', tree_snow_cluster:'tree',
                   palm_lone:'tree', palm_cluster:'tree', oasis:'tree', grass_tuft:'grass', reed:'grass',
                   mountain:'mountain', mountain_snow:'mountain', rock:'rock', cactus:'cactus' },
    },
  
    methods: {
      toGrid(def) {
        if (Array.isArray(def)) return { w: def[0].length, h: def.length, cells: def.join('').split('') };
        return { w: def.w, h: def.cells.length / def.w, cells: def.cells };
      },
  
      hash01(a, b) {   // детерминированный «шум» для формы
        let h = (Math.imul(a + 1, 374761393) + Math.imul(b + 1, 668265263)) >>> 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      },
  
      shade(hex, step) { return step ? this.color.blend(hex, step > 0 ? '#ffffff' : '#000000', Math.abs(step) * 0.07) : hex; },
      warmTint(hex, w) { return w ? this.color.blend(hex, '#d9b84a', 0.09) : hex; },
  
      resolvePalette(climate, season) {
        const d = this.pixelDecor, f = d.foliage[climate][season], w = d.wood[climate], s = d.stone[climate];
        return { l:f[0], L:f[1], d:f[2], g:f[0], G:f[1], D:f[2], T:w[0], t:w[1], r:s[0], R:s[1], k:s[2],
                 S: climate === 'hot' ? '#eadcc0' : '#ffffff', s:'#b9cfe0' };
      },
  
      resolveFamily(kind, climate, season) {   // одно «дерево» — разные виды по климату и сезону
        if (kind !== 'tree') return kind;
        if (climate === 'cold') return 'pine';
        if (climate === 'hot') return 'palm';
        return season === 'WINTER' ? 'bare' : 'oak';
      },
  
      buildSprite(sp) {
        const d = this.pixelDecor;
        const variants = d.patterns[sp.family];
        const { w, h, cells } = d.toGrid(variants[sp.shape % variants.length]);
        const pal = d.resolvePalette(sp.climate, sp.season);
  
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d');
        for (let i = 0; i < cells.length; i++) {
          const role = cells[i]; if (!role || role === '.' || role === ' ') continue;
          const x = i % w, y = (i / w) | 0;
          const structural = role === 'T' || role === 't' || y === h - 1;
          if (!structural && d.hash01(sp.seed, i) < 0.10) continue;          // форма: выпадают «рыхлые» пиксели
          let color = role[0] === '#' ? role : pal[role];
          if ('lLdgGDrRk'.includes(role)) color = d.warmTint(d.shade(color, sp.shade), sp.warm);   // цвет: яркость и тёплый сдвиг
          g.fillStyle = color;
          g.fillRect(x, y, 1, 1);
        }
        return { canvas: c, w, h };
      },
  
      getSprite(icon, region) {
        const d = this.pixelDecor, climate = region.climateZone || 'temperate', season = this.currentSeason;
        if (d.cacheSeason !== season) { d.cache.clear(); d.cacheSeason = season; }   // нужен только текущий сезон
        const family = d.resolveFamily(icon.kind, climate, season);
        const key = `${family}|${icon.shape}|${icon.seed}|${icon.flip}|${icon.shade}|${icon.warm}|${climate}`;
        let s = d.cache.get(key);
        if (!s) { s = d.buildSprite({ family, climate, season, shape: icon.shape, seed: icon.seed, flip: icon.flip, shade: icon.shade, warm: icon.warm }); d.cache.set(key, s); }
        return s;
      },
  
      paint(ctx, visibleRect = null, keep = 1) {
        if (this.viewMode === 'factions' || ['food','gold','production','manpower','ether'].includes(this.viewMode)) return;
        const d = this.pixelDecor;
        const px = ctx.getTransform().a;                                        // device-пикселей на мировую единицу
        const cell = Math.max(1, Math.round(d.cellWorld * px)) / px;            // клетка = целое число пикселей
        ctx.imageSmoothingEnabled = false;
  
        for (const region of this.terrain.regions.all) {
          const icons = region.icons;
          if (!icons?.length) continue;
          if (visibleRect && !this.bboxIntersects(region.bbox, visibleRect)) continue;
          for (const icon of icons) {
              
            if (icon.lod > keep) continue;                                      // LOD: на дальних слоях часть иконок пропускаем
            
            const s = d.getSprite(icon, region);
            const w = s.w * cell * icon.scale, h = s.h * cell * icon.scale;
            const drawX = Math.round((icon.x - w / 2) * px) / px;
            const drawY = Math.round((icon.y - h / 2) * px) / px;

            // 1. Отрисовка тени (черный полупрозрачный силуэт со смещением)
            
            if(icon.kind == 'tree'){
                ctx.save();
                ctx.globalAlpha = 0.08;     
                ctx.filter = 'brightness(0)';  
                const shadowCenterX = drawX + w / 2 + 1;
                const shadowCenterY = drawY + h / 2 + 1 ;

                ctx.translate(shadowCenterX, shadowCenterY);
                ctx.rotate(1.5);
                ctx.drawImage(s.canvas, -w / 2, -h / 2, w*0.75, h);
                ctx.restore(); 
            }

            // 2. Отрисовка самого объекта поверх тени
            ctx.drawImage(s.canvas, drawX, drawY, w, h);
          }
        }
      },
    },
  };