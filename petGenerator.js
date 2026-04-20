/**
 * petGenerator.js — 画像解析 → Petオブジェクト生成
 * 各解析ステップは独立関数（差し替え可能・architecture.md準拠）
 * 閾値・係数はすべて外部定数として定義（issues.md準拠）
 */

// ===== 定数（外部定数・後調整容易） =====

/** 名前生成テーブル（形容詞×名詞・各3文字以内で6文字上限を保証） */
const NAME_ADJECTIVES = [
  'あかい', 'あおい', 'きいろ', 'くろい', 'しろい',
  'つよい', 'はやい', 'おおき', 'ちいさ', 'ひかる',
  'やさし', 'こわい', 'かわい', 'するど', 'ふかい',
  'たかい', 'にぶい', 'しずか', 'にぎや', 'ふるい',
  'あつい', 'つめた', 'かたい', 'やわら', 'くらい',
  'あかる', 'おもい', 'かるい', 'ながい', 'みじか',
  'まるい', 'するり', 'ぬるい', 'にごり', 'すみき',
  'はげし', 'おだや', 'ふわり', 'ぎらり', 'ひそか',
];
const NAME_NOUNS = [
  'トラ', 'リュウ', 'ホシ', 'カゼ', 'ヒカリ',
  'ウミ', 'モリ', 'イワ', 'クモ', 'ナミ',
  'キバ', 'ツメ', 'タマ', 'ホノ', 'コオリ',
  'ムシ', 'ハナ', 'ツキ', 'タイヨ', 'カミ',
  'ユキ', 'カワ', 'ソラ', 'クサ', 'ミズ',
  'ケムリ', 'カゲ', 'ヒカリ', 'ドロ', 'スナ',
  'キリ', 'アメ', 'ライ', 'ドク', 'タタリ',
  'エン', 'ミコ', 'タキ', 'ヤマ', 'シマ',
];

/** ランダム名生成（形容詞+名詞・最大6文字） */
function generateName() {
  const adj  = NAME_ADJECTIVES[Math.floor(Math.random() * NAME_ADJECTIVES.length)];
  const noun = NAME_NOUNS[Math.floor(Math.random() * NAME_NOUNS.length)];
  return (adj + noun).slice(0, 6);
}

/** ペット種類（typeIndex と encyclopediaFlags の順序に対応） */
export const PET_TYPES = [
  { id: 'dragon',  label: 'ドラゴン系', animClass: 'pet-anim-dragon',  statFocus: '攻撃',   description: '古代より伝わる幻の竜族。鋭い牙と爪で敵を圧倒する、攻撃特化の頂点捕食者。'               }, // 0
  { id: 'bird',    label: '鳥類系',     animClass: 'pet-anim-bird',    statFocus: 'MP',     description: '風を読み、空を自在に舞う翼の使者。軽やかな動きでMPを活かした戦法を得意とする。'          }, // 1
  { id: 'beast',   label: '野獣系',     animClass: 'pet-anim-beast',   statFocus: '攻撃・防御', description: '本能のままに荒野を駆ける猛獣。攻撃と防御を兼ね備えたバランス型の強敵。'              }, // 2
  { id: 'slime',   label: 'スライム系', animClass: 'pet-anim-slime',   statFocus: 'HP',     description: 'どんな傷もゆっくり癒す粘質の体。打たれ強さとHPの高さで長期戦を制する。'                }, // 3
  { id: 'spirit',  label: '精霊系',     animClass: 'pet-anim-spirit',  statFocus: 'MP',     description: '自然の力が宿る神秘的な存在。実体が薄く捉えがたいが、MPを源に不思議な力を発揮する。'     }, // 4
  { id: 'aqua',    label: '水棲系',     animClass: 'pet-anim-aqua',    statFocus: 'HP・防御', description: '深海の静寂に生きる水の住人。頑強な体とHPで粘り強く戦い抜く。'                        }, // 5
  { id: 'insect',  label: '昆虫系',     animClass: 'pet-anim-insect',  statFocus: '攻撃',   description: '鋭い顎と素早い羽ばたきで相手を翻弄する。攻撃力に特化した速攻型の戦士。'                }, // 6
  { id: 'plant',   label: '植物系',     animClass: 'pet-anim-plant',   statFocus: 'HP',     description: '大地の養分をゆっくり蓄える緑の生命体。高いHPで嵐が過ぎるのをじっと待つ。'              }, // 7
  { id: 'golem',   label: '岩石系',     animClass: 'pet-anim-golem',   statFocus: '防御',   description: '硬い外殻に守られた不動の要塞。防御力は全種中最高峰、崩すことはほぼ不可能。'             }, // 8
  { id: 'phantom', label: '幻影系',     animClass: 'pet-anim-phantom', statFocus: 'MP',     description: '影と光の狭間に揺れる謎めいた幻。MPを糧に予測不能な動きで敵を惑わせる。'                }, // 9
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

/** デバッグ：trueにすると生成完了overlay分散値を表示 */
const DEBUG_RARITY = false;

/** ノイズ（分散）によるレア度閾値 */
const RARITY_THRESHOLDS = [
  { min: 6200, label: '伝説' },
  { min: 4800, label: '英雄' },
  { min: 3400, label: '希少' },
  { min: 2500, label: '高級' },
  { min:    0, label: '一般' },
];

/** 輪郭解析：エッジ密度閾値（輪郭 → 種類）既存5種用・変更禁止 */
const EDGE_DENSITY_THRESHOLDS = {
  aspect_tall:   0.8,   // 縦横比（高さ/幅）：縦長判定
  aspect_wide:   1.3,   // 横長判定
  center_y_high: 0.48,  // 重心Y（正規化）：上寄り（実測cy分布中央に合わせ調整）
  center_y_low:  0.58,  // 重心Y：下寄り
  edge_high:     0.28,  // エッジ密度高（実測中央値ベースに調整）
  edge_low:      0.12,  // エッジ密度低（実測下限ベースに調整）
};

/** 新5種専用独立閾値定数（既存定数と分離・既存分岐に影響しない） */
const NEW_TYPE_THRESHOLDS = {
  edge_very_low:  0.03,  // 幻影系：精霊系より更に低いエッジ
  edge_very_high: 0.44,  // 岩石系：実測上位20%ベースに調整
  edge_mid:       0.15,  // 水棲系：実測最小値付近に調整
  aspect_mid_low: 0.85,  // 水棲系・植物系：中央帯の下限
  aspect_mid_high: 1.25, // 水棲系：中央帯の上限（aspect_wideより低い）
};

// ===== 種類補正（事後ランダム補正） =====

/** 画像由来のtypeIndexに対して40%の確率でランダム種類に補正する */
function adjustTypeIndex(baseTypeIndex) {
  if (Math.random() < 0.40) {
    return Math.floor(Math.random() * 10);
  }
  return baseTypeIndex;
}

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
    typeIndex:   adjustTypeIndex(typeResult.typeIndex),
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
 * 判定順：新種（独立定数）→ 既存種（既存定数）の順で評価
 * 既存5種(0〜4)の判定条件は変更しない
 */
export function analyzeContour(pixels, width, height) {
  const gray        = toGrayscale(pixels, width, height);
  const edgeDensity = sobelEdgeDensity(gray, width, height);
  const { cx, cy }  = centerOfMass(gray, width, height);
  const aspectRatio = height / width; // 高さ/幅

  const T  = EDGE_DENSITY_THRESHOLDS;
  const NT = NEW_TYPE_THRESHOLDS;

  // ===== 新5種判定（独立定数使用・既存分岐より上位で評価） =====

  // 幻影系：エッジ極小（精霊系より更に低い）
  if (edgeDensity < NT.edge_very_low) {
    return { typeIndex: 9, edgeDensity, aspectRatio };
  }

  // 岩石系：エッジ極大（野獣系より更に高い）
  if (edgeDensity >= NT.edge_very_high) {
    return { typeIndex: 8, edgeDensity, aspectRatio };
  }

  // 昆虫系：エッジ高・重心上寄り（野獣系の細分化）
  if (edgeDensity >= T.edge_high && cy < T.center_y_high) {
    return { typeIndex: 6, edgeDensity, aspectRatio };
  }

  // 水棲系：エッジ中帯・アスペクト中央帯
  if (edgeDensity >= NT.edge_mid && edgeDensity < T.edge_high &&
      aspectRatio >= NT.aspect_mid_low && aspectRatio <= NT.aspect_mid_high) {
    return { typeIndex: 5, edgeDensity, aspectRatio };
  }

  // ===== 既存5種判定（条件変更なし） =====

  let typeIndex = 4; // デフォルト: 精霊系

  if (edgeDensity < T.edge_low) {
    typeIndex = 4; // 精霊系（エッジ最低）
  } else if (edgeDensity < T.edge_high && aspectRatio > T.aspect_wide && cy < T.center_y_high) {
    typeIndex = 1; // 鳥類系（横長・重心上・エッジ中）
  } else if (edgeDensity >= T.edge_high) {
    typeIndex = 2; // 野獣系（エッジ高・昆虫系に該当しない残余）
  } else if (aspectRatio < T.aspect_tall && cy > T.center_y_low) {
    typeIndex = 3; // スライム系（正方形・重心下・エッジ低）
  } else if (aspectRatio >= T.aspect_tall && aspectRatio <= T.aspect_wide) {
    typeIndex = 0; // ドラゴン系（縦長・エッジ中）
  } else {
    typeIndex = 7; // 植物系（上記いずれにも該当しない残余）
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

  if (DEBUG_RARITY) console.log(`[DEBUG_RARITY] variance=${variance.toFixed(1)}`);

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
    name:        generateName(),               // 表示名（最大6文字・リネーム可）
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
    evolutionStage: 0,                 // 進化段階（0=未進化/1=stage1/2=stage2）
    generation:  1,                    // 画像生成ペットは1世（バッジなし・2世以上でバッジ表示）
    statCaps:    calcStatCaps(typeIndex, personality, rarity),
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

// ===== 繁殖 =====

/** 繁殖コスト定数 */
export const BREED_COST_MULTIPLIER = 50; // 50 × ユーザーLv
export const BREED_HUNGER_MIN      = 50; // 両親の空腹度下限
export const BREED_PET_CAP         = 20; // 所持ペット上限
export const BREED_STAT_INHERIT    = 0.7; // ステータス継承係数
export const BREED_EVOLUTION_MIN   = 2;  // 繁殖に必要な最低進化段階

// ===== ステータス上限 =====

/** 全ペット共通の基準上限 */
const BASE_STAT_CAP = 80;

/**
 * 種類別ステータス上限ボーナス（typeIndex順・PET_TYPESと対応）
 * 各エントリ: { hp, mp, attack, defense }
 */
const TYPE_STAT_BONUS = [
  { hp:  0, mp:  0, attack: 15, defense:  0 }, // 0: ドラゴン系
  { hp:  0, mp: 15, attack:  0, defense:  0 }, // 1: 鳥類系
  { hp:  0, mp:  0, attack:  7, defense:  7 }, // 2: 野獣系
  { hp: 15, mp:  0, attack:  0, defense:  0 }, // 3: スライム系
  { hp:  0, mp: 15, attack:  0, defense:  0 }, // 4: 精霊系
  { hp:  7, mp:  0, attack:  0, defense:  7 }, // 5: 水棲系
  { hp:  0, mp:  0, attack: 15, defense:  0 }, // 6: 昆虫系
  { hp: 15, mp:  0, attack:  0, defense:  0 }, // 7: 植物系
  { hp:  0, mp:  0, attack:  0, defense: 15 }, // 8: 岩石系
  { hp:  0, mp: 15, attack:  0, defense:  0 }, // 9: 幻影系
];

/**
 * 性格別ステータス上限ボーナス（personalityIndex順・PERSONALITIESと対応）
 * 各エントリ: { hp, mp, attack, defense }
 */
const PERSONALITY_CAP_BONUS = [
  { hp:  0, mp:  0, attack: 10, defense:  0 }, // 0: 勇猛
  { hp:  0, mp: 10, attack:  0, defense:  0 }, // 1: 活発
  { hp: 10, mp:  0, attack:  0, defense:  0 }, // 2: 強靭
  { hp:  0, mp:  0, attack:  0, defense: 10 }, // 3: 堅固
  { hp:  0, mp:  0, attack:  0, defense:  0 }, // 4: 神秘（ボーナスなし）
];

/** 等級別全ステータス上限ボーナス */
const RARITY_CAP_BONUS = {
  '伝説': 15,
  '英雄': 10,
  '希少':  6,
  '高級':  3,
  '一般':  0,
};

/**
 * ステータス上限オブジェクトを計算して返す
 * @param {number} typeIndex
 * @param {number} personalityIndex
 * @param {string} rarity
 * @returns {{ hp: number, mp: number, attack: number, defense: number }}
 */
export function calcStatCaps(typeIndex, personalityIndex, rarity) {
  const tb = TYPE_STAT_BONUS[typeIndex]         ?? { hp: 0, mp: 0, attack: 0, defense: 0 };
  const pb = PERSONALITY_CAP_BONUS[personalityIndex] ?? { hp: 0, mp: 0, attack: 0, defense: 0 };
  const rb = RARITY_CAP_BONUS[rarity]           ?? 0;
  return {
    hp:      BASE_STAT_CAP + tb.hp      + pb.hp      + rb,
    mp:      BASE_STAT_CAP + tb.mp      + pb.mp      + rb,
    attack:  BASE_STAT_CAP + tb.attack  + pb.attack  + rb,
    defense: BASE_STAT_CAP + tb.defense + pb.defense + rb,
  };
}

/**
 * 2体のペットから子Petオブジェクトを生成する
 * @param {Pet} parentA
 * @param {Pet} parentB
 * @param {Blob} inheritedBlob - 親どちらかのimageData（50/50で呼び出し元が選択）
 * @returns {Pet}
 */
export function breedPet(parentA, parentB, inheritedBlob) {
  // 種族決定：同種→固定、異種→50/50
  const typeIndex = parentA.typeIndex === parentB.typeIndex
    ? parentA.typeIndex
    : (Math.random() < 0.5 ? parentA.typeIndex : parentB.typeIndex);

  // 性格：50/50ランダム
  const personalityIndex = Math.random() < 0.5
    ? parentA.personalityIndex
    : parentB.personalityIndex;

  // 属性：50/50ランダム
  const attribute = Math.random() < 0.5 ? parentA.attribute : parentB.attribute;

  // レア度：50/50ランダム
  const rarity = Math.random() < 0.5 ? parentA.rarity : parentB.rarity;

  // ステータス継承：両親平均×0.7・最低1
  const inheritStat = (a, b) => Math.max(1, Math.floor(((a + b) / 2) * BREED_STAT_INHERIT));

  const id = `pet_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  return {
    id,
    name:             generateName(),
    typeIndex,
    type:             PET_TYPES[typeIndex].label,
    level:            1,
    hp:               inheritStat(parentA.hp,      parentB.hp),
    mp:               inheritStat(parentA.mp,      parentB.mp),
    attack:           inheritStat(parentA.attack,  parentB.attack),
    defense:          inheritStat(parentA.defense, parentB.defense),
    hunger:           100,
    personalityIndex,
    personality:      PERSONALITIES[personalityIndex].label,
    skill:            SKILLS[personalityIndex].id,
    attribute,
    rarity,
    imageData:        inheritedBlob,
    evolutionStage:   0,
    generation:       Math.max(parentA.generation ?? 1, parentB.generation ?? 1) + 1,
    statCaps:         calcStatCaps(typeIndex, personalityIndex, rarity),
  };
}
