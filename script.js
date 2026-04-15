/**
 * script.js — エントリポイント
 * T1：ペット生成UI・画面遷移・ステータスバー・ケージ表示・図鑑表示
 * T2：庭表示・下部パネル
 * T3：餌システム（ショップUI・餌購入・ステータス上昇）
 */

import { initDB, getUser, saveUser, getAllPets, getPet, savePet, registerNewPet } from './state.js';
import { generatePetFromImage, PET_TYPES, PERSONALITIES } from './petGenerator.js';
import { spendCurrency } from './economy.js';

// ===== 起動 =====
(async () => {
  try {
    await initDB();
    await renderStatusBar();
    await renderEncyclopedia();
    await renderCage();
    await renderGarden();
    await renderShop();
    initNavigation();
    initGenerateScreen();
  } catch (err) {
    console.error('起動エラー:', err);
  }
})();

// ===== ナビゲーション =====
function initNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.screen;
      switchScreen(target);
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function switchScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`screen-${name}`);
  if (target) target.classList.add('active');
}

// ===== ステータスバー =====
async function renderStatusBar() {
  const user = await getUser();
  document.getElementById('user-level').textContent  = `Lv.${user.level}`;
  document.getElementById('currency-value').textContent = user.currency;

  const neededExp = user.level * 100;
  const pct = Math.min((user.exp / neededExp) * 100, 100);
  document.getElementById('exp-bar').style.width = `${pct}%`;
}

// ===== 生成画面 =====
function initGenerateScreen() {
  const uploadZone  = document.getElementById('upload-zone');
  const imageInput  = document.getElementById('image-input');
  const previewWrap = document.getElementById('preview-wrap');
  const previewImg  = document.getElementById('preview-img');
  const generateBtn = document.getElementById('generate-btn');
  const resultArea  = document.getElementById('generate-result');
  const canvas      = document.getElementById('analyze-canvas');

  let selectedFile  = null;

  // アップロードゾーンクリック
  uploadZone.addEventListener('click', () => imageInput.click());
  uploadZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') imageInput.click();
  });

  // ファイル選択
  imageInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('画像ファイルを選択してください');
      return;
    }
    selectedFile = file;
    const url = URL.createObjectURL(file);
    previewImg.src = url;
    previewImg.onload = () => URL.revokeObjectURL(url);
    previewWrap.hidden   = false;
    generateBtn.hidden   = false;
    resultArea.hidden    = true;
    uploadZone.hidden    = false;
  });

  // 生成ボタン
  generateBtn.addEventListener('click', async () => {
    if (!selectedFile) return;
    generateBtn.disabled    = true;
    generateBtn.textContent = '解析中... 🔍';

    try {
      const pet  = await generatePetFromImage(selectedFile, canvas);
      const user = await registerNewPet(pet);

      await renderStatusBar();
      await renderEncyclopedia();
      await renderCage();

      // 生成完了オーバーレイ表示
      showGeneratedOverlay(pet);

    } catch (err) {
      console.error('生成エラー:', err);
      alert('ペット生成に失敗しました。別の画像をお試しください。');
    } finally {
      generateBtn.disabled    = false;
      generateBtn.textContent = 'ペットを生成する ✨';
    }
  });
}

// ===== 生成完了オーバーレイ =====
function showGeneratedOverlay(pet) {
  const overlay  = document.getElementById('overlay-generated');
  const infoArea = document.getElementById('overlay-pet-info');

  // ペット画像プレビュー
  const imgEl = document.createElement('img');
  imgEl.className = 'overlay-pet-img';
  const blobUrl = URL.createObjectURL(pet.imageData);
  imgEl.src = blobUrl;
  imgEl.onload = () => {};  // blobUrlはOK後に解放しない（表示中は保持）

  infoArea.innerHTML = '';
  infoArea.appendChild(imgEl);

  const infoHTML = `
    <div class="result-row">種類: <span>${pet.type}</span></div>
    <div class="result-row">性格: <span>${pet.personality}</span></div>
    <div class="result-row">属性: <span>${pet.attribute}</span></div>
    <div class="result-row">レア度: <span>${pet.rarity}</span></div>
    <div class="result-row">HP: <span>${pet.hp}</span> / MP: <span>${pet.mp}</span></div>
    <div class="result-row">攻撃: <span>${pet.attack}</span> / 防御: <span>${pet.defense}</span></div>
  `;
  infoArea.insertAdjacentHTML('beforeend', infoHTML);

  overlay.classList.remove('hidden');

  document.getElementById('overlay-ok-btn').onclick = () => {
    overlay.classList.add('hidden');
    URL.revokeObjectURL(blobUrl);
    switchScreen('cage');
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.screen === 'cage');
    });
  };
}

// ===== ケージ =====
async function renderCage() {
  const grid = document.getElementById('cage-grid');
  grid.innerHTML = '';

  const user = await getUser();
  const pets = await getAllPets();

  pets.forEach(pet => {
    const card    = document.createElement('div');
    card.className = 'cage-card';
    if (user.gardenPetIds.includes(pet.id)) card.classList.add('in-garden');

    // ペット画像
    const imgEl   = document.createElement('img');
    const blobUrl = URL.createObjectURL(pet.imageData);
    imgEl.src     = blobUrl;
    imgEl.onload  = () => {};
    imgEl.alt     = pet.type;

    const name = document.createElement('div');
    name.className   = 'cage-card-name';
    name.textContent = `${pet.type}`;

    const badges = document.createElement('div');
    badges.className = 'cage-card-badges';
    badges.innerHTML = `
      <span class="badge">${pet.personality}</span>
      <span class="badge">${pet.attribute}</span>
      <span class="badge">${pet.rarity}</span>
    `;

    card.append(imgEl, name, badges);

    // 庭への配置トグル
    card.addEventListener('click', async () => {
      const u = await getUser();
      const idx = u.gardenPetIds.indexOf(pet.id);
      if (idx >= 0) {
        u.gardenPetIds.splice(idx, 1);
        card.classList.remove('in-garden');
      } else {
        if (u.gardenPetIds.length >= u.gardenSlots) {
          alert(`庭に出せるペットは${u.gardenSlots}体までです`);
          return;
        }
        u.gardenPetIds.push(pet.id);
        card.classList.add('in-garden');
      }
      await saveUser(u);
      await renderGarden();
    });

    grid.appendChild(card);
  });

  // 空きスロット（生成画面へのショートカット）
  const emptySlot = document.createElement('div');
  emptySlot.className = 'cage-empty-slot';
  emptySlot.innerHTML = '<span>＋</span><span style="font-size:12px">ペットを生成</span>';
  emptySlot.addEventListener('click', () => {
    switchScreen('generate');
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.remove('active');  // 生成タブはナビにないため全off
    });
  });
  grid.appendChild(emptySlot);
}

// ===== 庭（T2） =====
async function renderGarden() {
  const user      = await getUser();
  const petsArea  = document.getElementById('garden-pets');
  const emptyMsg  = document.getElementById('garden-empty-msg');
  petsArea.innerHTML = '';

  if (user.gardenPetIds.length === 0) {
    emptyMsg.hidden = false;
    return;
  }
  emptyMsg.hidden = true;

  for (const petId of user.gardenPetIds) {
    const pet = await getPet(petId);
    if (!pet) continue;

    // Canvas正方形クロップ＋角丸処理（spec.md 7.2）
    const canvas  = document.createElement('canvas');
    const SIZE    = 80;
    const RADIUS  = 16;
    canvas.width  = SIZE;
    canvas.height = SIZE;
    canvas.className = `garden-pet ${PET_TYPES[pet.typeIndex]?.animClass ?? ''}`;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', pet.type);

    const blobUrl = URL.createObjectURL(pet.imageData);
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      // 正方形クロップ（min辺基準・中央）
      const s  = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth  - s) / 2;
      const sy = (img.naturalHeight - s) / 2;
      // 角丸クリッピング
      ctx.beginPath();
      ctx.roundRect(0, 0, SIZE, SIZE, RADIUS);
      ctx.clip();
      ctx.drawImage(img, sx, sy, s, s, 0, 0, SIZE, SIZE);
      URL.revokeObjectURL(blobUrl);
    };
    img.onerror = () => URL.revokeObjectURL(blobUrl);
    img.src = blobUrl;

    // タップ → 下部パネル
    canvas.addEventListener('click', () => showPetPanel(pet));
    petsArea.appendChild(canvas);
  }
}

// ===== 下部パネル（庭ペットタップ時） =====
function showPetPanel(pet) {
  const panel  = document.getElementById('pet-panel');
  const content = document.getElementById('panel-content');

  const hungerDots = Array.from({ length: 5 }, (_, i) =>
    `<span style="font-size:18px">${i < Math.round(pet.hunger / 20) ? '🍖' : '◯'}</span>`
  ).join('');

  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <div class="panel-badge-type">${pet.type}</div>
      <div class="panel-badge-personality">${pet.personality}</div>
      <div style="font-size:12px;color:var(--color-text-light)">${pet.attribute} / ${pet.rarity}</div>
    </div>
    ${statBar('HP',   pet.hp,      'hp')}
    ${statBar('MP',   pet.mp,      'mp')}
    ${statBar('攻撃', pet.attack,  'atk')}
    ${statBar('防御', pet.defense, 'def')}
    <div class="panel-stat-row">
      <div class="panel-stat-label">空腹度</div>
      <div style="display:flex;gap:4px">${hungerDots}</div>
    </div>
    <div style="margin-top:14px;display:flex;justify-content:center">
      <button id="panel-feed-btn" class="btn-primary" style="font-size:13px;padding:10px 24px">
        🍖 えさをあげる
      </button>
    </div>
  `;

  panel.classList.remove('hidden');
  panel.classList.add('open');

  document.getElementById('panel-feed-btn').addEventListener('click', async () => {
    const btn = document.getElementById('panel-feed-btn');
    btn.disabled = true;
    const result = await feedPet(pet);
    if (!result.ok) {
      btn.disabled = false;
      alert(result.message);
      return;
    }
    // パネルをpet最新状態で再描画
    const updated = await getPet(pet.id);
    if (updated) {
      Object.assign(pet, updated);
      showPetPanel(pet);
    }
    await renderStatusBar();
    await renderGarden();
  });

  document.getElementById('panel-close').onclick = () => {
    panel.classList.remove('open');
    panel.classList.add('hidden');
  };
}

function statBar(label, value, cssClass) {
  return `
    <div class="panel-stat-row">
      <div class="panel-stat-label">${label}: ${value}/100</div>
      <div class="stat-bar-wrap">
        <div class="stat-bar ${cssClass}" style="width:${value}%"></div>
      </div>
    </div>
  `;
}

// ===== T3：餌システム定数 =====

/** ステータス上昇確率減衰（spec.md 1.5） */
const STAT_DECAY = [
  { threshold: 0.91, multiplier: 0.1 },
  { threshold: 0.71, multiplier: 0.5 },
  { threshold: 0,    multiplier: 1.0 },
];

/** 性格別成長補正（PERSONALITIES配列インデックスに対応） */
const PERSONALITY_BONUS = [
  { stat: 'attack',  mult: 1.5 }, // 0:勇猛
  { stat: 'mp',      mult: 1.5 }, // 1:活発
  { stat: 'hp',      mult: 1.5 }, // 2:強靭
  { stat: 'defense', mult: 1.5 }, // 3:堅固
  { stat: 'all',     mult: 1.2 }, // 4:神秘
];

/** レア成長確率・値 */
const RARE_GROWTH_PROB  = 0.05; // 5%
const RARE_GROWTH_VALUE = 10;

/** 通常成長：+1〜+5 */
const STAT_GROWTH_MIN = 1;
const STAT_GROWTH_MAX = 5;

/** 餌の空腹回復量 */
const FEED_HUNGER_RESTORE = 20;

/** 餌のHP回復量 */
const FEED_HP_RESTORE = 20;

/** ステータス上限 */
const STAT_CAP = 100;

/**
 * 1ステータスの上昇量を計算（確率減衰・性格補正適用）
 * @param {number} current - 現在値
 * @param {boolean} bonusStat - 性格ボーナス対象か
 * @param {number} bonusMult - ボーナス倍率
 * @returns {number} 上昇量（0以上）
 */
function calcStatGain(current, bonusStat, bonusMult) {
  const ratio = current / STAT_CAP;
  const decayEntry = STAT_DECAY.find(d => ratio >= d.threshold);
  const decayMult  = decayEntry ? decayEntry.multiplier : 0.1;

  // 減衰確率でスキップ判定（×1.0以外は確率的にスキップ）
  if (decayMult < 1.0 && Math.random() > decayMult) return 0;

  const isRare = Math.random() < RARE_GROWTH_PROB;
  let gain = isRare
    ? RARE_GROWTH_VALUE
    : Math.floor(Math.random() * (STAT_GROWTH_MAX - STAT_GROWTH_MIN + 1)) + STAT_GROWTH_MIN;

  if (bonusStat) gain = Math.round(gain * bonusMult);
  return gain;
}

/**
 * 餌やり処理（T3コア）
 * @param {Pet} pet
 * @returns {Promise<{ok: boolean, message?: string}>}
 */
async function feedPet(pet) {
  const user  = await getUser();
  const price = 10 * user.level;

  const { ok } = await spendCurrency(price);
  if (!ok) return { ok: false, message: `通貨が足りません（必要: 🪙${price}）` };

  const fresh = await getPet(pet.id);
  if (!fresh) return { ok: false, message: 'ペットデータが見つかりません' };

  // 空腹度回復
  fresh.hunger = Math.min(100, fresh.hunger + FEED_HUNGER_RESTORE);

  // HP+20回復
  fresh.hp = Math.min(STAT_CAP, fresh.hp + FEED_HP_RESTORE);

  // 全ステータスが上限か判定
  const allCapped = fresh.mp >= STAT_CAP && fresh.attack >= STAT_CAP && fresh.defense >= STAT_CAP;

  if (!allCapped) {
    const bonus = PERSONALITY_BONUS[fresh.personalityIndex] ?? PERSONALITY_BONUS[4];

    const applyGain = (stat) => {
      if (fresh[stat] >= STAT_CAP) return;
      const isBonusStat = bonus.stat === stat || bonus.stat === 'all';
      const gain = calcStatGain(fresh[stat], isBonusStat, bonus.mult);
      fresh[stat] = Math.min(STAT_CAP, fresh[stat] + gain);
    };

    applyGain('mp');
    applyGain('attack');
    applyGain('defense');
  }

  await savePet(fresh);
  return { ok: true };
}

// ===== T3：ショップ =====
async function renderShop() {
  const container = document.getElementById('shop-items');
  container.innerHTML = '';

  const user  = await getUser();
  const price = 10 * user.level;

  const card = document.createElement('div');
  card.className = 'shop-card';
  card.innerHTML = `
    <div class="shop-card-icon">🍖</div>
    <div class="shop-card-info">
      <h3>ペットフード</h3>
      <p>空腹度回復・HP+20・ステータス上昇</p>
    </div>
    <span class="shop-price">🪙${price}</span>
    <button class="btn-buy" id="shop-buy-feed">購入</button>
  `;
  container.appendChild(card);

  document.getElementById('shop-buy-feed').addEventListener('click', async () => {
    const btn = document.getElementById('shop-buy-feed');
    // 庭の先頭ペットに給餌（庭にペットがいない場合は選択不可）
    const u    = await getUser();
    if (u.gardenPetIds.length === 0) {
      alert('庭にペットを出してから餌を与えてください');
      return;
    }
    btn.disabled = true;
    const pet = await getPet(u.gardenPetIds[0]);
    if (!pet) { btn.disabled = false; return; }

    const result = await feedPet(pet);
    btn.disabled = false;
    if (!result.ok) {
      alert(result.message);
      return;
    }
    // 価格表示・ステータスバー更新
    const updated = await getUser();
    const newPrice = 10 * updated.level;
    document.querySelector('#shop-items .shop-price').textContent = `🪙${newPrice}`;
    await renderStatusBar();
  });
}

// ===== 図鑑 =====
async function renderEncyclopedia() {
  const grid = document.getElementById('encyclopedia-grid');
  grid.innerHTML = '';

  const user = await getUser();
  const pets = await getAllPets();

  PET_TYPES.forEach((type, idx) => {
    const unlocked = user.encyclopediaFlags[idx];
    const item     = document.createElement('div');
    item.className = `enc-item${unlocked ? ' unlocked' : ''}`;

    const canvas   = document.createElement('canvas');
    canvas.width   = 56;
    canvas.height  = 56;

    if (unlocked) {
      // 解放済み：最初に見つかったPetの画像を表示
      const matchPet = pets.find(p => p.typeIndex === idx);
      if (matchPet) {
        const img = new Image();
        const url = URL.createObjectURL(matchPet.imageData);
        img.onload = () => {
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 56, 56);
          URL.revokeObjectURL(url);
        };
        img.src = url;
      }
    } else {
      // 未解放：シルエット（黒塗り）
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#333';
      ctx.fillRect(0, 0, 56, 56);
      ctx.fillStyle = '#222';
      ctx.font = '28px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', 28, 28);
    }

    const nameEl     = document.createElement('div');
    nameEl.className = 'enc-item-name';
    nameEl.textContent = unlocked ? type.label : '???';

    item.append(canvas, nameEl);
    grid.appendChild(item);
  });
}
