/**
 * petGenerator.js — 画像解析 → Petオブジェクト生成
 * 各解析ステップは独立関数（差し替え可能・architecture.md準拠）
 * 閾値・係数はすべて外部定数として定義（issues.md準拠）
 */

// ===== 定数（外部定数・後調整容易） =====

/** ペット種類（typeIndex と encyclopediaFlags の順序に対応） */
export const PET_TYPES = [
  { id: 'dragon', label: 'ドラゴン系', animClass: 'pet-anim-dragon' },
  { id: 'bird',   label: '鳥類系',     animClass: 'pet-anim-bird'   },
  { id: 'beast',  label: '野獣系',     animClass: 'pet-anim-beast'  },
  { id: 'slime',  label: 'スライム系', animClass: 'pet-anim-slime'  },
  { id: 'spirit', label: '精霊系',     animClass: 'pet-anim-spirit' },
];

/** 性格（輝度範囲・成長補正） */
export const PERSONALITIES = [
  { id: 'brave',    label: '勇猛', bonus: 'attack'  },
  { id: 'active',   label: '活発', bonus: 'mp'      },
  { id: 'tough',    label: '強靭', bonus: 'hp'      },
  { id: 'solid',    label: '堅固', bonus: 'defense' },
  { id: 'mystic',   label: '神秘', bonus: 'all'     },
];

/**
 * スキル定義（性格indexと1対1対応）
 * winRateBonus: クランプ前に加算する勝率補正値
 */
export const SKILLS = [
  { id: 'fierce',  label: '猛攻', winRateBonus: 0.15 }, // 0:勇猛
  { id: 'swift',   label: '俊足', winRateBonus: 0.10 }, // 1:活発
  { id: 'grit',    label: '不屈', winRateBonus: 0.10 }, // 2:強靭
  { id: 'barrier', label: '鉄壁', winRateBonus: 0.10 }, // 3:堅固
  { id: 'oracle',  label: '神託', winRateBonus: 0.12 }, // 4:神秘
];

/** 属性（平均Hue帯域） */
export const ATTRIBUTES = ['火', '水', '草', '闇', '光'];

/** 初期ステータス範囲 */
const INIT_STAT_MIN = 10;
const INIT_STAT_MAX = 30;

/** ノイズ（分散）によるレア度閾値 */
const RARITY_THRESHOLDS = [
  { min: 2500, label: '★★★ レア'  },
  { min: 1500, label: '★★ アンコモン' },
  { min:    0, label: '★ コモン'   },
];

/** 輪郭解析：エッジ密度閾値（輪郭 → 種類） */
const EDGE_DENSITY_THRESHOLDS = {
  aspect_tall:   0.8,   // 縦横比（高さ/幅）：縦長判定
  aspect_wide:   1.3,   // 横長判定
  center_y_high: 0.42,  // 重心Y（正規化）：上寄り
  center_y_low:  0.58,  // 重心Y：下寄り
  edge_high:     0.18,  // エッジ密度高
  edge_low:      0.06,  // エッジ密度低
};

// ===== メイン生成関数 =====

/**
 * 画像ファイルからPetオブジェクトを生成する
 * @param {File} imageFile
 * @param {HTMLCanvasElement} canvas - 解析用canvas（非表示でよい）
 * @returns {Promise<Pet>}
 */
export async function generatePetFromImage(imageFile, canvas) {
  const imageData = await loadImageToCanvas(imageFile, canvas);
  const pixels    = imageData.data; // Uint8ClampedArray [r,g,b,a, ...]
  const width     = imageData.width;
  const height    = imageData.height;

  const attribute  = analyzeColor(pixels);
  const typeResult = analyzeContour(pixels, width, height);
  const personality = analyzePersonality(pixels);
  const rarity     = analyzeRarity(pixels);

  const pet = buildPetObject({
    typeIndex:   typeResult.typeIndex,
    personality,
    attribute,
    rarity,
    imageBlob:   imageFile,
  });

  return pet;
}

// ===== 独立解析関数群 =====

/**
 * [色解析] 平均RGBのHueから属性を決定
 * 火(red)=0°, 水(blue)=180-270°, 草(green)=90-150°, 闇=低輝度, 光=高輝度
 */
export function analyzeColor(pixels) {
  const { r, g, b } = averageRGB(pixels);
  const hue          = rgbToHue(r, g, b);
  const brightness   = (r + g + b) / 3;

  if (brightness < 50)  return ATTRIBUTES[3]; // 闇
  if (brightness > 210) return ATTRIBUTES[4]; // 光
  if (hue >= 0   && hue < 45)  return ATTRIBUTES[0]; // 火
  if (hue >= 45  && hue < 165) return ATTRIBUTES[2]; // 草
  if (hue >= 165 && hue < 270) return ATTRIBUTES[1]; // 水
  return ATTRIBUTES[0]; // 暖色 → 火
}

/**
 * [輪郭解析] エッジ検出（Sobel簡易版）→ 種類決定
 * spec.md 1.2 の輪郭特徴に対応
 */
export function analyzeContour(pixels, width, height) {
  const gray      = toGrayscale(pixels, width, height);
  const edgeDensity = sobelEdgeDensity(gray, width, height);
  const { cx, cy } = centerOfMass(gray, width, height);
  const aspectRatio = height / width; // 高さ/幅

  const T = EDGE_DENSITY_THRESHOLDS;
  let typeIndex = 4; // デフォルト: 精霊系

  if (edgeDensity < T.edge_low) {
    typeIndex = 4; // 精霊系（エッジ最低）
  } else if (edgeDensity < T.edge_high && aspectRatio > T.aspect_wide && cy < T.center_y_high) {
    typeIndex = 1; // 鳥類系（横長・重心上・エッジ中）
  } else if (edgeDensity >= T.edge_high) {
    typeIndex = 2; // 野獣系（エッジ高）
  } else if (aspectRatio < T.aspect_tall && cy > T.center_y_low) {
    typeIndex = 3; // スライム系（正方形・重心下・エッジ低）
  } else if (aspectRatio >= T.aspect_tall && aspectRatio <= T.aspect_wide) {
    typeIndex = 0; // ドラゴン系（縦長・エッジ中）
  }

  return { typeIndex, edgeDensity, aspectRatio };
}

/**
 * [明るさ解析] 輝度平均 → 性格決定（spec.md 1.3）
 * 輝度を0-255で5等分：高→低 = 勇猛/活発/強靭/堅固/神秘
 */
export function analyzePersonality(pixels) {
  const { r, g, b } = averageRGB(pixels);
  // 輝度 = 知覚輝度
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;

  if (luma >= 204) return 0; // 勇猛
  if (luma >= 153) return 1; // 活発
  if (luma >= 102) return 2; // 強靭
  if (luma >= 51)  return 3; // 堅固
  return 4;                  // 神秘
}

/**
 * [ノイズ解析] ピクセル輝度の分散 → レア度決定
 */
export function analyzeRarity(pixels) {
  const luminances = [];
  for (let i = 0; i < pixels.length; i += 4) {
    const luma = 0.299 * pixels[i] + 0.587 * pixels[i+1] + 0.114 * pixels[i+2];
    luminances.push(luma);
  }
  const mean     = luminances.reduce((a, b) => a + b, 0) / luminances.length;
  const variance = luminances.reduce((a, b) => a + (b - mean) ** 2, 0) / luminances.length;

  for (const t of RARITY_THRESHOLDS) {
    if (variance >= t.min) return t.label;
  }
  return RARITY_THRESHOLDS[RARITY_THRESHOLDS.length - 1].label;
}

// ===== Petオブジェクト生成 =====

function buildPetObject({ typeIndex, personality, attribute, rarity, imageBlob }) {
  const id = `pet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  return {
    id,
    typeIndex,                         // encyclopediaFlags配列の添字
    type:        PET_TYPES[typeIndex].label,
    level:       1,
    hp:          randStat(),
    mp:          randStat(),
    attack:      randStat(),
    defense:     randStat(),
    hunger:      100,
    personalityIndex: personality,
    personality: PERSONALITIES[personality].label,
    skill:       SKILLS[personality].id,  // 性格と1対1対応
    attribute,
    rarity,
    imageData:   imageBlob,            // Blob（IndexedDBに保存）
  };
}

function randStat() {
  return Math.floor(Math.random() * (INIT_STAT_MAX - INIT_STAT_MIN + 1)) + INIT_STAT_MIN;
}

// ===== 画像ユーティリティ =====

/** Fileを canvas に描画して ImageData を返す */
function loadImageToCanvas(file, canvas) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      // 正方形クロップ（Canvas APIで min辺に合わせる）
      const size = Math.min(img.naturalWidth, img.naturalHeight);
      const sx   = (img.naturalWidth  - size) / 2;
      const sy   = (img.naturalHeight - size) / 2;
      const ANALYZE_SIZE = 128; // 解析用リサイズ（軽量化）

      canvas.width  = ANALYZE_SIZE;
      canvas.height = ANALYZE_SIZE;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, size, size, 0, 0, ANALYZE_SIZE, ANALYZE_SIZE);

      const data = ctx.getImageData(0, 0, ANALYZE_SIZE, ANALYZE_SIZE);
      URL.revokeObjectURL(url);
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('画像読み込み失敗')); };
    img.src = url;
  });
}

/** ピクセル配列の平均RGB */
function averageRGB(pixels) {
  let r = 0, g = 0, b = 0, count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i+3] < 10) continue; // 透明ピクセル除外
    r += pixels[i]; g += pixels[i+1]; b += pixels[i+2];
    count++;
  }
  if (count === 0) return { r: 128, g: 128, b: 128 };
  return { r: r/count, g: g/count, b: b/count };
}

/** RGB → Hue（0-359） */
function rgbToHue(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  let h;
  const d = max - min;
  if      (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else                h = ((r - g) / d + 4) / 6;
  return Math.round(h * 360);
}

/** ピクセル配列をグレースケール2D配列に変換 */
function toGrayscale(pixels, width, height) {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    gray[i] = 0.299 * pixels[p] + 0.587 * pixels[p+1] + 0.114 * pixels[p+2];
  }
  return gray;
}

/** Sobel簡易エッジ検出 → エッジ密度（0~1） */
function sobelEdgeDensity(gray, width, height) {
  let edgeCount = 0;
  const total = (width - 2) * (height - 2);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx  = y * width + x;
      const gx = (
        -gray[idx - width - 1] + gray[idx - width + 1]
        - 2*gray[idx - 1]      + 2*gray[idx + 1]
        - gray[idx + width - 1]+ gray[idx + width + 1]
      );
      const gy = (
        -gray[idx - width - 1] - 2*gray[idx - width] - gray[idx - width + 1]
        + gray[idx + width - 1]+ 2*gray[idx + width]+ gray[idx + width + 1]
      );
      const mag = Math.sqrt(gx*gx + gy*gy);
      if (mag > 30) edgeCount++;
    }
  }
  return edgeCount / total;
}

/** 輝度重心（正規化 0~1）を返す */
function centerOfMass(gray, width, height) {
  let sumX = 0, sumY = 0, total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = gray[y * width + x];
      sumX += x * v; sumY += y * v; total += v;
    }
  }
  if (total === 0) return { cx: 0.5, cy: 0.5 };
  return { cx: sumX / (total * width), cy: sumY / (total * height) };
}
