/* ============================================================
   MapRenderer — камера и взаимодействие с картой.
   Сама карта рисуется в MapPainter один раз в большой скрытый холст (buffer) в масштабе 1:1.
   Камера просто показывает нужный кусок этого холста с нужным зумом — поэтому двигать и зумить быстро.

   Камера: camera.x / camera.y — мировые координаты (в пикселях карты) левого верхнего угла экрана.
   ============================================================ */
   class MapRenderer {
    constructor(canvas, map, options = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.map = map;
        this.options = {
            tileSize: 16,          // размер клетки в пикселях (9, 12, 15...)
            minZoom: 0.1,
            maxZoom: 13,
            zoomStep: 1.15,        // во сколько раз меняется зум за один «щелчок» колеса
            keyPanStep: 60,        // шаг движения камеры стрелками, в экранных пикселях
            backgroundColor: '#0f1418',
            mood: 'dark',          // 'dark' (dark fantasy) | 'light'
            ...options
        };

        this.painter = new MapPainter(map, this.options);
        this.buffer = document.createElement('canvas'); // пока пустой; после refresh() — холст painter'а

        this.view = 'terrain';     // 'terrain' | 'temperature' | 'regions'
        this.seasonName = 'summer';
        this.mood = this.options.mood;
        this.showBorders = true;
        this.camera = { x: 0, y: 0, zoom: 1 };
        this.sprites = new SpriteRenderer();
        this.objects = [];         // объекты на карте: города, армии... (см. setObjects)
        this.onObjectClick = null; // функция (object) => void — клик по объекту
        this.selection = null;     // { tile, region, edges } — выделенная клетка и её регион
        this.onSelect = null;      // функция (tileInfo, regionInfo) => void
        this.onHover = null;       // функция (tileInfo | null) => void

        this.dragging = false;
        this.pressStart = null;
        this.lastPointer = { x: 0, y: 0 };

        this.bindEvents();
        new ResizeObserver(() => this.resize()).observe(canvas);
        this.resize();
    }

    /* ---------- Публичные методы ---------- */

    // Вызывать после каждой новой генерации карты.
    refresh() {
        this.selection = null;
        this.rebuildBuffer();
        this.fitToView();
    }

    setView(view) {
        this.view = view;
        this.rebuildBuffer();
        this.draw();
    }

    setSeason(name) {
        if (!SEASONS[name]) return;
        this.seasonName = name;
        this.rebuildBuffer();
        this.draw();
    }

    // 'dark' — dark fantasy (приглушённые цвета, туман, мёртвые деревья, мрачные детали); 'light' — обычный стиль.
    setMood(mood) {
        this.mood = mood;
        this.rebuildBuffer();
        this.draw();
    }

    setShowSettlements(show) {
        this.painter.options.settlements = show;
        this.rebuildBuffer();
        this.draw();
    }

    setShowBorders(show) {
        this.showBorders = show;
        this.rebuildBuffer();
        this.draw();
    }

    /* ---------- Объекты (города, деревни, армии...) ---------- */

    /* Объект рисуется по конфигу функцией SpriteRenderer, поверх карты, на экране (а не в буфере карты),
       поэтому армии можно двигать и менять без перерисовки всей карты.
         { id: 'army-1',
           config: SPRITE_EXAMPLES.army,         // описание объекта
           tile: [x, y],                         // клетка карты (основание объекта — внизу клетки)
           offset: [0, 0],                       // сдвиг в пикселях (для клетки 12×12), чтобы поставить точнее
           options: { colors: { team: '#c33' }, flags: ['marching'], frame: 0, flipX: false } }
       Сезон в options подставляется автоматически (текущий сезон карты), если вы не указали свой. */
    setObjects(list) {
        this.objects = list.slice();
        this.draw();
    }

    addObject(object) {
        this.objects = this.objects.filter(o => o.id !== object.id).concat(object);
        this.draw();
    }

    removeObject(id) {
        this.objects = this.objects.filter(o => o.id !== id);
        this.draw();
    }

    // Где на экране стоит объект: левый верхний угол и размер спрайта.
    objectBox(object) {
        const unit = this.options.tileSize / 12;                 // спрайты нарисованы для клетки 12×12
        const sprite = this.sprites.render(object.config, { season: this.seasonName, ...object.options });
        const [tileX, tileY] = object.tile;
        const [offsetX, offsetY] = object.offset || [0, 0];
        const baseX = tileX * this.options.tileSize + this.options.tileSize / 2 + offsetX * unit;
        const baseY = tileY * this.options.tileSize + this.options.tileSize * 0.85 + offsetY * unit;
        const zoom = this.camera.zoom;
        const factor = unit * zoom / sprite.scale;
        return {
            sprite,
            baseY,
            x: (baseX - this.camera.x) * zoom - sprite.anchorX * factor,
            y: (baseY - this.camera.y) * zoom - sprite.anchorY * factor,
            width: sprite.width * factor,
            height: sprite.height * factor
        };
    }

    drawObjects() {
        if (this.objects.length === 0) return;
        const { ctx, canvas } = this;
        const boxes = this.objects.map(object => ({ object, ...this.objectBox(object) }));
        boxes.sort((a, b) => a.baseY - b.baseY); // южнее (ближе) — рисуется позже и перекрывает

        ctx.save();
        ctx.imageSmoothingEnabled = false;
        for (const box of boxes) {
            if (box.x > canvas.width || box.y > canvas.height || box.x + box.width < 0 || box.y + box.height < 0) continue;
            ctx.drawImage(box.sprite.canvas, box.x, box.y, box.width, box.height);
        }
        ctx.restore();
    }

    // Объект под точкой экрана (самый южный из перекрывающихся) или null.
    objectAt(point) {
        const hit = this.objects
            .map(object => ({ object, ...this.objectBox(object) }))
            .filter(b => point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height)
            .sort((a, b) => b.baseY - a.baseY);
        return hit.length ? hit[0].object : null;
    }

    rebuildBuffer() {
        this.buffer = this.painter.paint({ view: this.view, seasonName: this.seasonName, showBorders: this.showBorders, mood: this.mood });
    }

    /* ---------- Камера ---------- */

    get worldSize() {
        return this.map.size * this.options.tileSize;
    }

    // Показать всю карту целиком по центру.
    fitToView() {
        const zoom = Math.min(this.canvas.width, this.canvas.height) / this.worldSize;
        this.camera.zoom = clamp(zoom, this.options.minZoom, this.options.maxZoom);
        this.centerOn(this.worldSize / 2, this.worldSize / 2);
    }

    centerOn(worldX, worldY) {
        this.camera.x = worldX - this.canvas.width / 2 / this.camera.zoom;
        this.camera.y = worldY - this.canvas.height / 2 / this.camera.zoom;
        this.clampCamera();
        this.draw();
    }

    // Не даём камере улететь слишком далеко: за краем карты можно видеть не больше половины экрана.
    clampCamera() {
        const cam = this.camera;
        const viewW = this.canvas.width / cam.zoom;
        const viewH = this.canvas.height / cam.zoom;
        cam.x = clamp(cam.x, -viewW / 2, this.worldSize - viewW / 2);
        cam.y = clamp(cam.y, -viewH / 2, this.worldSize - viewH / 2);
    }

    // Сдвиг камеры на dx, dy экранных пикселей (карта «едет» вслед за пальцем/мышью).
    panBy(dx, dy) {
        this.camera.x -= dx / this.camera.zoom;
        this.camera.y -= dy / this.camera.zoom;
        this.clampCamera();
        this.draw();
    }

    // Зум так, чтобы точка под курсором осталась на месте.
    zoomAt(screenX, screenY, factor) {
        const cam = this.camera;
        const worldBefore = this.screenToWorld(screenX, screenY);

        cam.zoom = clamp(cam.zoom * factor, this.options.minZoom, this.options.maxZoom);
        cam.x = worldBefore.x - screenX / cam.zoom;
        cam.y = worldBefore.y - screenY / cam.zoom;
        this.clampCamera();
        this.draw();
    }

    screenToWorld(screenX, screenY) {
        return {
            x: this.camera.x + screenX / this.camera.zoom,
            y: this.camera.y + screenY / this.camera.zoom
        };
    }

    screenToTile(screenX, screenY) {
        const world = this.screenToWorld(screenX, screenY);
        return {
            x: Math.floor(world.x / this.options.tileSize),
            y: Math.floor(world.y / this.options.tileSize)
        };
    }

    /* ---------- Выделение по клику ---------- */

    // Клик выделяет клетку, а если это суша — ещё и весь её регион.
    selectAt(point) {
        const tile = this.screenToTile(point.x, point.y);
        const info = this.map.getTileInfo(tile.x, tile.y);
        if (!info) {
            this.clearSelection();
            return;
        }
        const region = this.map.getRegionInfo(info.regionId);
        this.selection = { tile: info, region, edges: region ? this.regionOutline(region) : [] };
        this.draw();
        if (this.onSelect) this.onSelect(info, region);
    }

    clearSelection() {
        if (!this.selection) return;
        this.selection = null;
        this.draw();
        if (this.onSelect) this.onSelect(null, null);
    }

    // Внешняя граница региона: отрезок для каждой стороны клетки, за которой уже другой регион (координаты — в клетках).
    regionOutline(region) {
        const { size, regionId } = this.map;
        const edges = [];
        for (const i of region.tiles) {
            const x = i % size;
            const y = Math.floor(i / size);
            if (x === 0 || regionId[i - 1] !== region.id) edges.push([x, y, x, y + 1]);
            if (x === size - 1 || regionId[i + 1] !== region.id) edges.push([x + 1, y, x + 1, y + 1]);
            if (y === 0 || regionId[i - size] !== region.id) edges.push([x, y, x + 1, y]);
            if (y === size - 1 || regionId[i + size] !== region.id) edges.push([x, y + 1, x + 1, y + 1]);
        }
        return edges;
    }

    // Рисуется поверх карты на экране, а не в буфере: выделение можно менять без перерисовки всей карты.
    drawSelection() {
        if (!this.selection) return;
        const { ctx, camera } = this;
        const tileSize = this.options.tileSize;
        const size = this.map.size;
        const cell = tileSize * camera.zoom; // размер клетки на экране
        const screenX = tileX => (tileX * tileSize - camera.x) * camera.zoom;
        const screenY = tileY => (tileY * tileSize - camera.y) * camera.zoom;
        const { tile, region, edges } = this.selection;

        ctx.save();
        ctx.lineJoin = 'round';

        if (region) {
            ctx.fillStyle = 'rgba(255, 240, 170, 0.18)';
            ctx.beginPath();
            for (const i of region.tiles) ctx.rect(screenX(i % size), screenY(Math.floor(i / size)), cell, cell);
            ctx.fill();

            ctx.beginPath();
            for (const [x1, y1, x2, y2] of edges) {
                ctx.moveTo(screenX(x1), screenY(y1));
                ctx.lineTo(screenX(x2), screenY(y2));
            }
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
            ctx.lineWidth = 5;
            ctx.stroke();
            ctx.strokeStyle = '#ffe27a';
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.lineWidth = 4;
        ctx.strokeRect(screenX(tile.x), screenY(tile.y), cell, cell);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(screenX(tile.x), screenY(tile.y), cell, cell);
        ctx.restore();
    }

    /* ---------- Вывод на экран ---------- */

    resize() {
        this.canvas.width = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;
        this.clampCamera();
        this.draw();
    }

    draw() {
        const { ctx, canvas, camera } = this;
        ctx.fillStyle = this.options.backgroundColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (this.buffer.width === 0) return;

        // При отдалении сглаживаем (иначе мерцает), при приближении оставляем чёткие пиксели.
        ctx.imageSmoothingEnabled = camera.zoom < 1;

        // Какой кусок мира сейчас виден, обрезанный по границам карты.
        const viewW = canvas.width / camera.zoom;
        const viewH = canvas.height / camera.zoom;
        const srcX = Math.max(0, camera.x);
        const srcY = Math.max(0, camera.y);
        const srcRight = Math.min(this.worldSize, camera.x + viewW);
        const srcBottom = Math.min(this.worldSize, camera.y + viewH);
        if (srcRight <= srcX || srcBottom <= srcY) return;

        ctx.drawImage(
            this.buffer,
            srcX, srcY, srcRight - srcX, srcBottom - srcY,
            (srcX - camera.x) * camera.zoom, (srcY - camera.y) * camera.zoom,
            (srcRight - srcX) * camera.zoom, (srcBottom - srcY) * camera.zoom
        );
        this.drawSelection();
        this.drawObjects();
    }

    /* ---------- Управление ---------- */

    bindEvents() {
        const canvas = this.canvas;

        canvas.addEventListener('pointerdown', e => {
            this.dragging = true;
            this.lastPointer = { x: e.clientX, y: e.clientY };
            this.pressStart = { x: e.clientX, y: e.clientY };
            canvas.setPointerCapture(e.pointerId);
            canvas.classList.add('dragging');
        });

        canvas.addEventListener('pointermove', e => {
            if (this.dragging) {
                this.panBy(e.clientX - this.lastPointer.x, e.clientY - this.lastPointer.y);
                this.lastPointer = { x: e.clientX, y: e.clientY };
            } else {
                this.reportHover(e);
            }
        });

        const stopDragging = () => {
            this.dragging = false;
            canvas.classList.remove('dragging');
        };
        canvas.addEventListener('pointerup', e => {
            const start = this.pressStart;
            stopDragging();
            // Клик — это нажатие без заметного перетаскивания.
            if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) {
                const point = this.pointerToCanvas(e);
                const object = this.onObjectClick ? this.objectAt(point) : null;
                if (object) this.onObjectClick(object);
                else this.selectAt(point);
            }
        });
        canvas.addEventListener('pointercancel', stopDragging);
        canvas.addEventListener('pointerleave', () => this.onHover && this.onHover(null));

        canvas.addEventListener('wheel', e => {
            e.preventDefault();
            const point = this.pointerToCanvas(e);
            const factor = e.deltaY < 0 ? this.options.zoomStep : 1 / this.options.zoomStep;
            this.zoomAt(point.x, point.y, factor);
        }, { passive: false });

        // Клавиатура: стрелки/WASD — движение, +/- — зум, Esc — снять выделение. Холст должен быть в фокусе.
        canvas.addEventListener('keydown', e => {
            const step = this.options.keyPanStep;
            const center = { x: canvas.width / 2, y: canvas.height / 2 };
            const actions = {
                ArrowLeft: () => this.panBy(step, 0), a: () => this.panBy(step, 0),
                ArrowRight: () => this.panBy(-step, 0), d: () => this.panBy(-step, 0),
                ArrowUp: () => this.panBy(0, step), w: () => this.panBy(0, step),
                ArrowDown: () => this.panBy(0, -step), s: () => this.panBy(0, -step),
                '+': () => this.zoomAt(center.x, center.y, this.options.zoomStep),
                '=': () => this.zoomAt(center.x, center.y, this.options.zoomStep),
                '-': () => this.zoomAt(center.x, center.y, 1 / this.options.zoomStep),
                Escape: () => this.clearSelection()
            };
            const action = actions[e.key];
            if (action) {
                e.preventDefault();
                action();
            }
        });
    }

    // Координаты курсора относительно холста (с учётом того, что CSS-размер может отличаться от размера холста).
    pointerToCanvas(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (this.canvas.width / rect.width),
            y: (e.clientY - rect.top) * (this.canvas.height / rect.height)
        };
    }

    reportHover(e) {
        if (!this.onHover) return;
        const point = this.pointerToCanvas(e);
        const tile = this.screenToTile(point.x, point.y);
        this.onHover(this.map.getTileInfo(tile.x, tile.y));
    }
}