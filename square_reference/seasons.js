/* ============================================================
   Сезоны. Для каждого времени года — своя палитра и параметры.

   Общая идея палитры: приглушённые, чуть «закопчённые» природные тона с тёплыми тенями
   (под суровую индустриальную эстетику), а не открыточно-яркие цвета. Сезоны различаются
   не только цветом, но и тем, КАК нарисована флора:
     весна  — молодая светлая зелень, цветущие деревья, ростки на полях, цветы на лугах;
     лето   — густая зелень, поля зреют жёлто-зелёным;
     осень  — рыже-золотая листва, спелые золотые поля, опавшие листья;
     зима   — голые лиственные деревья, ели со снегом, стерня, снег и лёд.

   tempShift — насколько сезон сдвигает температуру: от него зависит, где лежит снег и замерзает вода.

   Поля палитры:
     biome      — цвета биомов равнин: тундра, тайга, луг, степь, пустыня, саванна
     rock       — камень под горными пиками
     water      — 5 оттенков воды от мелководья к глубине; river — оттенки рек (берутся из water)
     ice        — лёд (у берега / глубже / на реках)
     snow, snowShade — снег на земле и пиках (светлая и теневая стороны)
     broadleaf  — цвета крон лиственных деревьев (у каждого дерева случайный из списка)
     conifer    — цвета елей
     trunk      — ствол
     blossom    — цвет цветков на деревьях (только весной)
     bareTrees  — true: лиственные деревья голые (зима)
     snowOnConifers — true: на елях лежит снег (там, где холодно)
     wheatStage — 'sprout' (ростки) | 'growing' (растёт) | 'ripe' (спелая) | 'bare' (стерня)
     groundDetail — цвета мелких деталей на лугах (цветы весной, листва осенью)
   ============================================================ */
   const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'];

   const SEASONS = {
       spring: {
           name: 'Весна',
           tempShift: 0.02,
           palette: {
               biome: ['#b2bfa8', '#557650', '#7fab5c', '#a9ac68', '#d1bd86', '#a5a55c'],
               rock: '#787780',
               water: ['#58a0bd', '#4a8ba8', '#3d7592', '#325f79', '#284d63'],
               ice: ['#d9e8ee', '#c5d9e3', '#adc6d3'],
               snow: '#eef3f5', snowShade: '#cdd8de',
               broadleaf: ['#5f9a47', '#7ab654'],
               conifer: ['#2c5236', '#3b6844'],
               trunk: '#5a3a1e',
               blossom: '#f0c2d0',
               bareTrees: false,
               snowOnConifers: false,
               wheatStage: 'sprout', wheatStalk: '#7cae4a', wheatTop: '#a9d46e',
               groundDetail: ['#f2e58f', '#ffffff', '#e6a3c0']
           }
       },
   
       summer: {
           name: 'Лето',
           tempShift: 0.08,
           palette: {
               biome: ['#a9b5a4', '#4b6a47', '#6e9350', '#b3a76a', '#d0bb82', '#a99b58'],
               rock: '#77757d',
               water: ['#4f95b3', '#41809e', '#346a87', '#2a566f', '#21445a'],
               ice: ['#d9e8ee', '#c5d9e3', '#adc6d3'],
               snow: '#eef3f5', snowShade: '#cdd8de',
               broadleaf: ['#2f5a2c', '#42733a'],
               conifer: ['#25452f', '#33593c'],
               trunk: '#5a3a1e',
               blossom: null,
               bareTrees: false,
               snowOnConifers: false,
               wheatStage: 'growing', wheatStalk: '#c2b73c', wheatTop: '#e0d478',
               groundDetail: null
           }
       },
   
       autumn: {
           name: 'Осень',
           tempShift: -0.08,
           palette: {
               biome: ['#aaa38a', '#4a6046', '#88904c', '#b8975a', '#caa877', '#a68b4e'],
               rock: '#76737a',
               water: ['#4a8199', '#3d6d85', '#315971', '#28485d', '#1f394b'],
               ice: ['#d9e8ee', '#c5d9e3', '#adc6d3'],
               snow: '#eef3f5', snowShade: '#cdd8de',
               broadleaf: ['#b5562b', '#d29a3a', '#9a3b26', '#6f8a3a'],
               conifer: ['#27432f', '#35563c'],
               trunk: '#54361c',
               blossom: null,
               bareTrees: false,
               snowOnConifers: false,
               wheatStage: 'ripe', wheatStalk: '#dcb03a', wheatTop: '#f0d071',
               groundDetail: ['#b5562b', '#d29a3a', '#8a3d22']
           }
       },
   
       winter: {
           name: 'Зима',
           tempShift: -0.2,
           palette: {
               biome: ['#c9d1d4', '#3f5847', '#7a8262', '#a3987a', '#c7b38b', '#978760'],
               rock: '#6f6e78',
               water: ['#4a7a94', '#3d6780', '#31546b', '#274456', '#1e3646'],
               ice: ['#d7e6ed', '#c2d6e0', '#a9c3d1'],
               snow: '#f2f6f8', snowShade: '#d3dde3',
               broadleaf: ['#5b4a3c'],
               conifer: ['#24402d', '#2f4f38'],
               trunk: '#5b4a3c',
               blossom: null,
               bareTrees: true,
               snowOnConifers: true,
               wheatStage: 'bare', wheatStalk: '#7d6a48', wheatTop: '#9a8760',
               groundDetail: null
           }
       }
   };
   
   // Реки красим теми же оттенками, что и мелкую воду.
   for (const season of Object.values(SEASONS)) {
       season.palette.river = season.palette.water.slice(0, 3);
   }
   
   /* ============================================================
      Тёмный стиль (dark fantasy). Палитры сезонов приглушаются: меньше насыщенность, темнее, холоднее тени.
      Всё остальное (цветокоррекция, туман, мёртвые деревья, мрачные детали) делает MapPainter при mood: 'dark'.
      Дополнительные поля палитры:
        deadTreeChance — доля лиственных деревьев, которые стоят мёртвыми и голыми даже летом
        fogStrength    — сила тумана в этом сезоне (множитель)
      ============================================================ */
   function toneHex(hex, { saturation = 1, light = 1, tint = [1, 1, 1] }) {
       const n = parseInt(hex.slice(1), 16);
       let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
       const luma = 0.299 * r + 0.587 * g + 0.114 * b;
       r = luma + (r - luma) * saturation;
       g = luma + (g - luma) * saturation;
       b = luma + (b - luma) * saturation;
       const out = [r * light * tint[0], g * light * tint[1], b * light * tint[2]]
           .map(v => Math.max(0, Math.min(255, Math.round(v))));
       return '#' + out.map(v => v.toString(16).padStart(2, '0')).join('');
   }
   
   const DARK_TONES = {
       land: { saturation: 0.55, light: 0.78, tint: [0.96, 1, 0.98] },
       rock: { saturation: 0.65, light: 0.82, tint: [0.97, 0.99, 1.02] },
       water: { saturation: 0.55, light: 0.68, tint: [0.88, 0.98, 1.03] },
       ice: { saturation: 0.55, light: 0.86, tint: [0.95, 1, 1.04] },
       snow: { saturation: 0.45, light: 0.92, tint: [0.96, 0.99, 1.03] },
       leaves: { saturation: 0.55, light: 0.72, tint: [0.97, 1, 0.97] },
       wood: { saturation: 0.7, light: 0.78 },
       crops: { saturation: 0.5, light: 0.8, tint: [0.98, 1, 0.94] },
       litter: { saturation: 0.4, light: 0.78 }
   };
   
   const DARK_EXTRA = {
       spring: { deadTreeChance: 0.3, fogStrength: 0.9 },
       summer: { deadTreeChance: 0.2, fogStrength: 0.6 },
       autumn: { deadTreeChance: 0.4, fogStrength: 1.0 },
       winter: { deadTreeChance: 0, fogStrength: 0.8 }
   };
   
   const DARK_SEASONS = {};
   for (const [name, season] of Object.entries(SEASONS)) {
       const p = season.palette;
       const tone = (list, preset) => list.map(color => toneHex(color, preset));
       const water = tone(p.water, DARK_TONES.water);
   
       DARK_SEASONS[name] = {
           name: season.name,
           tempShift: season.tempShift - 0.03,   // мир холоднее: снег ложится раньше
           palette: {
               ...p,
               biome: tone(p.biome, DARK_TONES.land),
               rock: toneHex(p.rock, DARK_TONES.rock),
               water,
               river: water.slice(0, 3),
               ice: tone(p.ice, DARK_TONES.ice),
               snow: toneHex(p.snow, DARK_TONES.snow),
               snowShade: toneHex(p.snowShade, DARK_TONES.snow),
               broadleaf: tone(p.broadleaf, DARK_TONES.leaves),
               conifer: tone(p.conifer, DARK_TONES.leaves),
               trunk: toneHex(p.trunk, DARK_TONES.wood),
               blossom: null,                       // цветущие деревья — не для этого мира
               wheatStalk: toneHex(p.wheatStalk, DARK_TONES.crops),
               wheatTop: toneHex(p.wheatTop, DARK_TONES.crops),
               groundDetail: p.groundDetail ? tone(p.groundDetail, DARK_TONES.litter) : null,
               ...DARK_EXTRA[name]
           }
       };
   }