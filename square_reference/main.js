/* ============================================================
   Точка входа: создаём генератор и рендерер, подключаем кнопки.
   Все параметры генерации можно переопределить здесь (полный список — MapGenerator.DEFAULTS).
   ============================================================ */
   const generator = new MapGenerator({
    size: 300,
    // shapeVariety: 1,       // 0..1: изрезанность континента (заливы, полуострова)
    // islandDensity: 0.8,    // 0..1: больше островов
    // inlandSeaStrength: 0.5,// внутренние моря
    // aridity: 0.1,          // меньше степей и пустынь
    // waterShare: 0.5,       // больше суши
    // mountainShare: 0.2,    // больше гор
    // riverCount: 30,
    // regionMinSize: 5,
    // regionMaxSize: 8,
});

const canvas = document.getElementById('map');
const renderer = new MapRenderer(canvas, generator);
const info = document.getElementById('info');

/* ---------- Подписи для интерфейса ---------- */

const TERRAIN_NAMES = ['глубокая вода', 'мелководье', 'равнина', 'гора'];
const BIOME_NAMES = ['тундра', 'тайга', 'равнина', 'степь', 'пустыня', 'саванна'];
const RESOURCE_NAMES = ['', 'дерево', 'пшеница', 'руда', 'эфирный разлом'];
const CROSSING_NAMES = ['', 'брод', 'каменный мост'];

function temperatureName(t) {
    if (t < 0.25) return 'холодно';
    if (t < 0.5) return 'прохладно';
    if (t < 0.75) return 'тепло';
    return 'жарко';
}

function describeTile(tile) {
    let kind = TERRAIN_NAMES[tile.terrain];
    if (tile.terrain < Terrain.PLAIN) kind = `${kind}, глубина ${tile.waterDepth}`;
    if (tile.terrain === Terrain.PLAIN) kind = tile.hasRiver ? `река (глубина ${tile.riverLevel})` : BIOME_NAMES[tile.biome];
    if (tile.crossing) kind += `, ${CROSSING_NAMES[tile.crossing]}`;

    const parts = [`(${tile.x}, ${tile.y})`, kind, `${temperatureName(tile.temperature)} (${Math.round(tile.temperature * 100)}%)`];
    if (tile.resource !== Resource.NONE) parts.push(`ресурс: ${RESOURCE_NAMES[tile.resource]}`);
    if (tile.settlement) parts.push(`поселение: ${tile.settlement.size} кл., население ${tile.settlement.population}`);
    if (tile.regionId >= 0) parts.push(`регион #${tile.regionId}, ${tile.regionSize} кв.`);
    return parts.join(' · ');
}

function showStats() {
    const landPercent = Math.round(generator.landShare * 100);
    const regions = generator.regionCount;
    const average = (generator.landTiles.length / regions).toFixed(1);
    info.textContent = `Суша: ${landPercent}% · регионов: ${regions} · в среднем ${average} кв. Наведите на квадрат.`;
}

/* ---------- Действия ---------- */

const seedInput = document.getElementById('seed');

function buildMap() {
    generator.generate(Number(seedInput.value) || 1);
    renderer.refresh();
    showStats();
}

renderer.onHover = tile => {
    if (tile) info.textContent = describeTile(tile);
};

/* ---------- Выделение по клику ---------- */

const selectionPanel = document.getElementById('selection');

function describeRegion(region) {
    const resources = region.resources
        .map((count, code) => (count > 0 && code !== Resource.NONE ? `${RESOURCE_NAMES[code]}: ${count}` : null))
        .filter(Boolean);
    const dominantBiome = BIOME_NAMES[region.biomes.indexOf(Math.max(...region.biomes))];

    const parts = [`Регион #${region.id}: ${region.size} кв.`, `население ${region.population}`, `преобладает ${dominantBiome}`];
    if (region.mountains > 0) parts.push(`гор: ${region.mountains}`);
    if (region.riverTiles > 0) parts.push(`рек: ${region.riverTiles}`);
    if (region.coastal) parts.push('выход к воде');
    parts.push(resources.length ? `ресурсы — ${resources.join(', ')}` : 'ресурсов нет');
    return parts.join(' · ');
}

renderer.onSelect = (tile, region) => {
    if (!tile) {
        selectionPanel.hidden = true;
        return;
    }
    selectionPanel.hidden = false;
    selectionPanel.textContent = region
        ? `Клетка ${describeTile(tile)}\n${describeRegion(region)}`
        : `Клетка ${describeTile(tile)}`;
};

/* ---------- Кнопки ---------- */

document.getElementById('generate').addEventListener('click', () => {
    seedInput.value = Math.floor(Math.random() * 99999);
    buildMap();
});

seedInput.addEventListener('change', buildMap);

document.getElementById('borders').addEventListener('change', e => renderer.setShowBorders(e.target.checked));

document.getElementById('fit').addEventListener('click', () => renderer.fitToView());

const seasonButtons = document.querySelectorAll('[data-season]');
seasonButtons.forEach(button => {
    button.addEventListener('click', () => {
        seasonButtons.forEach(other => other.setAttribute('aria-pressed', other === button));
        renderer.setSeason(button.dataset.season);
    });
});

/* ---------- Пример объектов на карте ---------- */

// Кнопка ставит на карту деревню, город и армию — просто чтобы показать, как это работает.
// Своё: renderer.setObjects([{ id, config, tile: [x, y], options }]) — формат конфигов описан в sprite-renderer.js.
const demoButton = document.getElementById('demo-objects');
demoButton.addEventListener('click', () => {
    const on = demoButton.getAttribute('aria-pressed') !== 'true';
    demoButton.setAttribute('aria-pressed', on);
    if (!on) {
        renderer.setObjects([]);
        return;
    }

    // Три свободные клетки суши поближе к центру карты.
    const center = generator.size / 2;
    const free = generator.landTiles
        .filter(i => generator.terrain[i] === Terrain.PLAIN && !generator.river[i] && generator.resource[i] === Resource.NONE)
        .sort((a, b) => Math.hypot(a % generator.size - center, Math.floor(a / generator.size) - center)
                      - Math.hypot(b % generator.size - center, Math.floor(b / generator.size) - center));
    const spot = k => [free[k * 6] % generator.size, Math.floor(free[k * 6] / generator.size)];

    renderer.setObjects([
        { id: 'city-1', config: SPRITE_EXAMPLES.city, tile: spot(0), options: { colors: { team: '#c0392b' } } },
        { id: 'village-1', config: SPRITE_EXAMPLES.village, tile: spot(1) },
        { id: 'army-1', config: SPRITE_EXAMPLES.army, tile: spot(2), options: { colors: { team: '#2e86c1' }, flags: ['marching'] } }
    ]);
});
renderer.onObjectClick = object => {
    info.textContent = `Объект: ${object.id}`;
};

function toggleButton(id, apply) {
    const button = document.getElementById(id);
    button.addEventListener('click', () => {
        const on = button.getAttribute('aria-pressed') !== 'true';
        button.setAttribute('aria-pressed', on);
        apply(on);
    });
}
toggleButton('mood', on => renderer.setMood(on ? 'dark' : 'light'));
toggleButton('settlements', on => renderer.setShowSettlements(on));

const viewButtons = document.querySelectorAll('[data-view]');
viewButtons.forEach(button => {
    button.addEventListener('click', () => {
        viewButtons.forEach(other => other.setAttribute('aria-pressed', other === button));
        renderer.setView(button.dataset.view);
    });
});

buildMap();