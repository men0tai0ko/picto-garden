/**
 * script.js — エントリポイント
 * T1：ペット生成UI・画面遷移・ステータスバー・ケージ表示・図鑑表示
 * T2：庭表示・下部パネル
 * T3：餌システム（ショップUI・餌購入・ステータス上昇）
 * T4：訓練画面UI・オートバトル
 * T5：報酬ループ（EXP・レベルアップ・レベルアップ演出）
 */

import { initDB, getUser, saveUser, getAllPets, getPet, savePet, registerNewPet } from './state.js';
import { generatePetFromImage, PET_TYPES, PERSONALITIES } from './petGenerator.js';
import { spendCurrency, earnCurrency } from './economy.js';
import { runBattle, DIFFICULTY_LEVELS, pickEnemyAttribute, getAffinityMultiplier } from './battle.js';

// ===== 起動 =====
(async () => {
  try {
    await initDB();
    await syncGardenSlots();
    await renderStatusBar();
    await renderEncyclopedia();
    await renderCage();
    await renderGarden();
    await renderShop();
    await renderBattle();
    initNavigation();
    initGenerateScreen();
    startHungerTimer();
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
      // 各画面を開くたびに最新状態で再描画
      if (target === 'battle') renderBattle();
      if (target === 'shop')   renderShop();
    });
  });
}

function switchScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`screen-${name}`);
  if (target) target.classList.add('active');
  // 画面切替時にステータスパネルを閉じる
  const panel = document.getElementById('pet-panel');
  panel.classList.remove('open');
  panel.classList.add('hidden');
  // 生成画面：庭スロット満杯警告
  if (name === 'generate') renderGenerateWarning();
}

/** 生成画面の上部に庭スロット満杯警告を表示 */
async function renderGenerateWarning() {
  const area = document.getElementById('generate-area');
  if (!area) return;
  let warn = document.getElementById('generate-warning');
  const user = await getUser();
  const isFull = user.gardenPetIds.length >= user.gardenSlots;
  if (isFull) {
    if (!warn) {
      warn = document.createElement('p');
      warn.id = 'generate-warning';
      warn.style.cssText = 'color:var(--color-hp);font-size:12px;text-align:center;background:rgba(232,84,84,0.1);border-radius:8px;padding:8px 12px;margin:0';
      area.insertBefore(warn, area.firstChild);
    }
    warn.textContent = `⚠️ 庭のスロットが満杯です（${user.gardenPetIds.length}/${user.gardenSlots}）。ケージからペットを外してください。`;
    warn.hidden = false;
  } else if (warn) {
    warn.hidden = true;
  }
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

      // 生成成功後にselectedFileをクリアしUIを初期化（連打防止）
      selectedFile         = null;
      imageInput.value     = '';
      previewWrap.hidden   = true;
      generateBtn.hidden   = true;
      resultArea.hidden    = true;

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

  const rarityDesc = {
    '★★★ レア':    '初期値・成長率高め',
    '★★ アンコモン': '初期値・成長率やや高め',
    '★ コモン':     '初期値・成長率ともに標準',
  };
  const infoHTML = `
    <div class="result-row">種類: <span>${pet.type}</span></div>
    <div class="result-row">性格: <span>${pet.personality}</span></div>
    <div class="result-row">属性: <span>${pet.attribute}</span></div>
    <div class="result-row">レア度: <span>${pet.rarity}</span></div>
    <div class="result-row" style="font-size:11px;color:var(--color-text-light)">${rarityDesc[pet.rarity] ?? ''}</div>
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
    imgEl.onload  = () => URL.revokeObjectURL(blobUrl);
    imgEl.onerror = () => URL.revokeObjectURL(blobUrl);
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

    const hpBar = document.createElement('div');
    hpBar.style.cssText = 'width:100%;margin-top:4px';
    hpBar.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 8px">
        <div>
          <div style="font-size:9px;color:var(--color-text-light);margin-bottom:2px">HP ${pet.hp}</div>
          <div class="stat-bar-wrap" style="height:5px"><div class="stat-bar hp" style="width:${pet.hp}%"></div></div>
        </div>
        <div>
          <div style="font-size:9px;color:var(--color-text-light);margin-bottom:2px">MP ${pet.mp}</div>
          <div class="stat-bar-wrap" style="height:5px"><div class="stat-bar mp" style="width:${pet.mp}%"></div></div>
        </div>
        <div>
          <div style="font-size:9px;color:var(--color-text-light);margin-bottom:2px">攻撃 ${pet.attack}</div>
          <div class="stat-bar-wrap" style="height:5px"><div class="stat-bar atk" style="width:${pet.attack}%"></div></div>
        </div>
        <div>
          <div style="font-size:9px;color:var(--color-text-light);margin-bottom:2px">防御 ${pet.defense}</div>
          <div class="stat-bar-wrap" style="height:5px"><div class="stat-bar def" style="width:${pet.defense}%"></div></div>
        </div>
      </div>
      <div style="margin-top:4px">
        <div style="font-size:9px;color:var(--color-text-light);margin-bottom:2px">空腹 ${pet.hunger}</div>
        <div class="stat-bar-wrap" style="height:5px"><div class="stat-bar hunger" style="width:${pet.hunger}%"></div></div>
      </div>
    `;

    // 給餌ボタン（カード内インライン）
    const feedRow = document.createElement('div');
    feedRow.style.cssText = 'display:flex;gap:6px;margin-top:8px;width:100%';

    const price   = 10 * user.level;
    const feedBtn  = document.createElement('button');
    feedBtn.className = 'btn-buy';
    feedBtn.style.cssText = 'flex:1;font-size:11px;padding:6px 0';
    feedBtn.textContent = `🍖 餌 🪙${price}`;

    const waterBtn = document.createElement('button');
    waterBtn.className = 'btn-buy';
    waterBtn.style.cssText = 'flex:1;font-size:11px;padding:6px 0;background:var(--color-mp)';
    waterBtn.textContent = '💧 水';

    feedRow.append(feedBtn, waterBtn);
    card.append(imgEl, name, badges, hpBar, feedRow);

    // 給餌ボタン：カードclickイベントへの伝播を止める
    feedBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      feedBtn.disabled = true;
      const fresh = await getPet(pet.id);
      if (!fresh) { feedBtn.disabled = false; return; }
      const result = await feedPet(fresh);
      if (!result.ok) { alert(result.message); feedBtn.disabled = false; return; }
      await renderStatusBar();
      await renderGarden();
      await renderCage();
    });

    waterBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      waterBtn.disabled = true;
      const fresh = await getPet(pet.id);
      if (!fresh) { waterBtn.disabled = false; return; }
      fresh.hp = Math.min(100, fresh.hp + 10);
      await savePet(fresh);
      await renderStatusBar();
      await renderGarden();
      await renderCage();
    });

    // 庭への配置トグル
    card.addEventListener('click', async () => {
      const u = await getUser();
      const idx = u.gardenPetIds.indexOf(pet.id);
      if (idx >= 0) {
        u.gardenPetIds.splice(idx, 1);
        card.classList.remove('in-garden');
      } else {
        if (u.gardenPetIds.length >= u.gardenSlots) {
          // 庭スロット満杯：追い出すペットを選択させる
          showEvictDialog(u, pet.id, card);
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

/**
 * 庭スロット満杯時：追い出すペットを選択するオーバーレイを表示
 * @param {User} user
 * @param {string} incomingPetId - 庭に入れたいペットID
 * @param {HTMLElement} incomingCard - 選択カード（クラス更新用）
 */
async function showEvictDialog(user, incomingPetId, incomingCard) {
  // 既存オーバーレイがあれば削除
  const existing = document.getElementById('evict-overlay');
  if (existing) existing.remove();

  const allPets = await getAllPets();
  const gardenPets = user.gardenPetIds.map(id => allPets.find(p => p.id === id)).filter(Boolean);

  const overlay = document.createElement('div');
  overlay.id = 'evict-overlay';
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="overlay-card" style="width:min(340px,92vw)">
      <h3 style="font-size:16px">庭がいっぱいです</h3>
      <p style="font-size:13px;color:var(--color-text-light);margin-top:-6px">外に出すペットを選んでください</p>
      <div id="evict-pet-list" style="display:flex;flex-direction:column;gap:8px;width:100%"></div>
      <button class="btn-primary" id="evict-cancel-btn" style="background:#aaa;margin-top:4px">キャンセル</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const list = document.getElementById('evict-pet-list');
  gardenPets.forEach(pet => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;background:var(--color-bg);border-radius:10px;padding:8px 12px;cursor:pointer';

    const canvas = document.createElement('canvas');
    canvas.width = 40; canvas.height = 40;
    canvas.style.cssText = 'border-radius:8px;flex-shrink:0';
    drawPetToCanvas(pet, canvas, 40, 6);

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;font-size:13px;font-weight:700';
    info.textContent = pet.type;

    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:10px;color:var(--color-text-light)';
    sub.textContent = `HP ${pet.hp} / 空腹 ${pet.hunger}`;
    info.appendChild(sub);

    row.append(canvas, info);
    row.addEventListener('click', async () => {
      overlay.remove();
      // 選択ペットを庭から除き、新ペットを追加
      const u = await getUser();
      const idx = u.gardenPetIds.indexOf(pet.id);
      if (idx >= 0) u.gardenPetIds.splice(idx, 1);
      u.gardenPetIds.push(incomingPetId);
      await saveUser(u);
      await renderCage();
      await renderGarden();
    });
    list.appendChild(row);
  });

  document.getElementById('evict-cancel-btn').addEventListener('click', () => overlay.remove());
}

// ===== 庭（T2） =====
async function renderGarden() {
  const user      = await getUser();
  const petsArea  = document.getElementById('garden-pets');
  const emptyMsg  = document.getElementById('garden-empty-msg');
  petsArea.innerHTML = '';

  if (user.gardenPetIds.length === 0) {
    emptyMsg.hidden = false;
    // 「ケージへ」ボタンを追加（初回のみ生成）
    let cageBtn = document.getElementById('garden-go-cage-btn');
    if (!cageBtn) {
      cageBtn = document.createElement('button');
      cageBtn.id        = 'garden-go-cage-btn';
      cageBtn.className = 'btn-primary';
      cageBtn.textContent = '🐾 ケージへ';
      cageBtn.style.cssText = 'position:absolute;bottom:38%;left:50%;transform:translateX(-50%);font-size:13px;padding:10px 24px';
      cageBtn.addEventListener('click', () => {
        switchScreen('cage');
        document.querySelectorAll('.nav-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.screen === 'cage');
        });
      });
      document.getElementById('screen-garden').appendChild(cageBtn);
    }
    cageBtn.hidden = false;
    return;
  }
  emptyMsg.hidden = true;
  const existingBtn = document.getElementById('garden-go-cage-btn');
  if (existingBtn) existingBtn.hidden = true;

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
async function showPetPanel(pet) {
  const panel  = document.getElementById('pet-panel');
  const content = document.getElementById('panel-content');

  const user  = await getUser();
  const price = 10 * user.level;

  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <div class="panel-badge-type">${pet.type}</div>
      <div class="panel-badge-personality">${pet.personality}</div>
      <div style="font-size:12px;color:var(--color-text-light)">${pet.attribute} / ${pet.rarity}</div>
    </div>
    ${statBar('HP',    pet.hp,     'hp')}
    ${statBar('MP',    pet.mp,     'mp')}
    ${statBar('攻撃',  pet.attack, 'atk')}
    ${statBar('防御',  pet.defense,'def')}
    ${statBar('空腹度', pet.hunger, 'hunger')}
    <div style="margin-top:14px;display:flex;gap:10px;justify-content:center">
      <button class="btn-primary" id="panel-feed-btn" style="padding:10px 20px;font-size:14px">🍖 餌 🪙${price}</button>
      <button class="btn-primary" id="panel-water-btn" style="padding:10px 20px;font-size:14px;background:var(--color-mp)">💧 おみず</button>
    </div>
  `;

  panel.classList.remove('hidden');
  panel.classList.add('open');

  document.getElementById('panel-feed-btn').addEventListener('click', async () => {
    const btn = document.getElementById('panel-feed-btn');
    btn.disabled = true;
    const fresh = await getPet(pet.id);
    if (!fresh) { btn.disabled = false; return; }
    const result = await feedPet(fresh);
    if (!result.ok) { alert(result.message); btn.disabled = false; return; }
    await renderStatusBar();
    await renderGarden();
    const updated = await getPet(pet.id);
    if (updated) showPetPanel(updated);
  });

  document.getElementById('panel-water-btn').addEventListener('click', async () => {
    const btn = document.getElementById('panel-water-btn');
    btn.disabled = true;
    const fresh = await getPet(pet.id);
    if (!fresh) { btn.disabled = false; return; }
    fresh.hp = Math.min(100, fresh.hp + 10);
    await savePet(fresh);
    await renderStatusBar();
    await renderGarden();
    const updated = await getPet(pet.id);
    if (updated) showPetPanel(updated);
  });

  document.getElementById('panel-close').onclick = () => {
    panel.classList.remove('open');
    panel.classList.add('hidden');
  };
}

// ===== 空腹度時間経過減少（tasks.md 改善提案・仕様#8） =====

/** 空腹度減少間隔（ms）・1回の減少量 */
const HUNGER_INTERVAL_MS  = 5 * 60 * 1000; // 5分
const HUNGER_DECREASE_VAL = 5;

/** 放置収益：ペット1体あたりの基本係数・1回あたり上限 */
const IDLE_INCOME_PER_PET = 1;
const IDLE_INCOME_CAP     = 50;

/** 庭スロット拡張：拡張発生Lv一覧・上限 */
const GARDEN_SLOT_LEVELS = [10, 20, 30, 40];
const GARDEN_SLOT_MAX    = 5;

/** 起動時に開始。全ペットの空腹度を定期減算しIndexedDB保存 */
function startHungerTimer() {
  setInterval(async () => {
    try {
      const pets = await getAllPets();
      for (const pet of pets) {
        if (pet.hunger <= 0) continue;
        pet.hunger = Math.max(0, pet.hunger - HUNGER_DECREASE_VAL);
        await savePet(pet);
      }

      // ===== 放置収益 =====
      const user = await getUser();
      // 庭在中かつ空腹度 > 0 のペット数をカウント
      const activeCount = user.gardenPetIds.filter(id => {
        const pet = pets.find(p => p.id === id);
        return pet && pet.hunger > 0;
      }).length;
      if (activeCount > 0) {
        const gain = Math.min(IDLE_INCOME_CAP, activeCount * user.level * IDLE_INCOME_PER_PET);
        await earnCurrency(gain);
        await renderStatusBar();
      }
      // ====================

      // 庭パネルが開いていれば表示を更新
      const panel = document.getElementById('pet-panel');
      if (panel.classList.contains('open')) {
        await renderGarden();
      }
      // ケージ画面が表示中であればカードを更新
      const cageScreen = document.getElementById('screen-cage');
      if (cageScreen.classList.contains('active')) {
        await renderCage();
      }
    } catch (err) {
      console.error('空腹度タイマーエラー:', err);
    }
  }, HUNGER_INTERVAL_MS);
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
const RARE_GROWTH_PROB  = 0.05; // 5%（フォールバック用・直接参照禁止）
const RARE_GROWTH_VALUE = 10;

/** レア度別レアボーナス確率（フォールバック: 5%） */
const RARITY_GROWTH_PROB = {
  '★★★ レア':    0.20,
  '★★ アンコモン': 0.10,
  '★ コモン':     0.05,
};

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
 * @param {number} [rarityGrowthProb] - レア度別ボーナス確率（省略時はコモン相当）
 * @returns {number} 上昇量（0以上）
 */
function calcStatGain(current, bonusStat, bonusMult, rarityGrowthProb = RARE_GROWTH_PROB) {
  const ratio = current / STAT_CAP;
  const decayEntry = STAT_DECAY.find(d => ratio >= d.threshold);
  const decayMult  = decayEntry ? decayEntry.multiplier : 0.1;

  // 減衰確率でスキップ判定（×1.0以外は確率的にスキップ）
  if (decayMult < 1.0 && Math.random() > decayMult) return 0;

  const isRare = Math.random() < rarityGrowthProb;
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

  // 全ステータスが上限か判定（HP回復前の実値で判定・spec.md 1.5）
  const allCapped = fresh.hp >= STAT_CAP && fresh.mp >= STAT_CAP && fresh.attack >= STAT_CAP && fresh.defense >= STAT_CAP;

  // HP+20回復（常時）
  fresh.hp = Math.min(STAT_CAP, fresh.hp + FEED_HP_RESTORE);

  if (!allCapped) {
    const bonus      = PERSONALITY_BONUS[fresh.personalityIndex] ?? PERSONALITY_BONUS[4];
    const growthProb = RARITY_GROWTH_PROB[fresh.rarity] ?? RARE_GROWTH_PROB;

    const applyGain = (stat) => {
      if (fresh[stat] >= STAT_CAP) return;
      const isBonusStat = bonus.stat === stat || bonus.stat === 'all';
      const gain = calcStatGain(fresh[stat], isBonusStat, bonus.mult, growthProb);
      fresh[stat] = Math.min(STAT_CAP, fresh[stat] + gain);
    };

    applyGain('hp');
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

  // ペットフード情報カード（給餌は庭パネルから）
  const card = document.createElement('div');
  card.className = 'shop-card';
  card.innerHTML = `
    <div class="shop-card-icon">🍖</div>
    <div class="shop-card-info">
      <h3>ペットフード</h3>
      <p>空腹度回復・HP+20・ステータス上昇</p>
      <p style="font-size:11px;color:var(--color-text-light);margin-top:4px">🏡 庭のペットをタップして給餌</p>
    </div>
    <span class="shop-price">🪙${price}</span>
  `;
  container.appendChild(card);

  // おみず情報カード
  const waterCard = document.createElement('div');
  waterCard.className = 'shop-card';
  waterCard.innerHTML = `
    <div class="shop-card-icon">💧</div>
    <div class="shop-card-info">
      <h3>おみず（無料）</h3>
      <p>HP+10回復。通貨がないときでも使える</p>
      <p style="font-size:11px;color:var(--color-text-light);margin-top:4px">🏡 庭のペットをタップして給餌</p>
    </div>
    <span class="shop-price">🪙0</span>
  `;
  container.appendChild(waterCard);
}

// ===== T4：訓練画面 =====

/** 訓練画面の状態（選択中難易度・選択中ペット・ログ・敵属性） */
let battleState = { difficultyId: 'normal', petId: null, log: [], enemyAttribute: null };

async function renderBattle() {
  const screen = document.getElementById('screen-battle');
  screen.innerHTML = '<h2 class="screen-title">訓練</h2><div id="battle-area" style="padding:0 16px 24px"></div>';

  const area = document.getElementById('battle-area');
  const user = await getUser();
  const pets = await getAllPets();

  // ペットがいない場合
  if (pets.length === 0) {
    area.innerHTML = '<p class="placeholder-msg">まずペットを生成しよう！</p>';
    return;
  }

  // 選択中ペットの初期値（gardenPetIds優先）
  if (!battleState.petId || !pets.find(p => p.id === battleState.petId)) {
    battleState.petId = user.gardenPetIds[0] ?? pets[0].id;
  }

  const selectedPet = pets.find(p => p.id === battleState.petId) ?? pets[0];

  // 敵属性：未抽選時のみ抽選（画面表示ごとに1回・難易度変更では再抽選しない）
  if (!battleState.enemyAttribute) {
    battleState.enemyAttribute = pickEnemyAttribute();
  }
  const enemyAttr    = battleState.enemyAttribute;
  const affinityMult = getAffinityMultiplier(selectedPet.attribute, enemyAttr);
  const affinityLabel = affinityMult > 1.0 ? '⬆️ 有利' : affinityMult < 1.0 ? '⬇️ 不利' : '➡️ 等倍';
  const affinityColor = affinityMult > 1.0 ? 'var(--color-main)' : affinityMult < 1.0 ? 'var(--color-hp)' : 'var(--color-text-light)';

  // ペット選択セクション
  const petSelectHTML = `
    <div style="margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;color:var(--color-text-light);margin-bottom:8px">ペット選択</div>
      <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px">
        ${pets.map(p => {
          const warn = p.hp <= 0 ? '⚠️HP0' : p.hunger <= 0 ? '⚠️空腹' : '';
          return `
          <div class="cage-card${p.id === battleState.petId ? ' in-garden' : ''}"
               style="min-width:80px;padding:8px"
               data-pet-id="${p.id}">
            <img src="" alt="${p.type}" style="width:56px;height:56px;border-radius:10px;object-fit:cover" data-blob-pet="${p.id}">
            <div class="cage-card-name" style="font-size:11px">${p.type}</div>
            ${warn ? `<div style="font-size:9px;color:var(--color-hp);font-weight:700;text-align:center;margin-top:2px">${warn}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
  `;

  // 難易度選択セクション
  const diffHTML = `
    <div style="margin-bottom:14px">
      <div style="font-size:13px;font-weight:700;color:var(--color-text-light);margin-bottom:8px">難易度</div>
      <div style="display:flex;gap:8px">
        ${DIFFICULTY_LEVELS.map(d => `
          <button class="btn-difficulty${battleState.difficultyId === d.id ? ' active' : ''}"
                  data-diff="${d.id}"
                  style="flex:1;padding:10px 4px;border-radius:var(--radius-btn);border:2px solid ${battleState.difficultyId === d.id ? 'var(--color-main)' : '#DDD'};
                         background:${battleState.difficultyId === d.id ? 'var(--color-main)' : 'var(--color-white)'};
                         color:${battleState.difficultyId === d.id ? 'var(--color-white)' : 'var(--color-text)'};
                         font-size:13px;font-weight:700;cursor:pointer">
            ${d.label}
          </button>
        `).join('')}
      </div>
      <div style="margin-top:8px;font-size:12px;color:var(--color-text-light);display:flex;align-items:center;gap:6px">
        <span>敵の属性: <strong>${enemyAttr}</strong></span>
        <span style="color:${affinityColor};font-weight:700">${affinityLabel}</span>
      </div>
    </div>
  `;

  // 選択ペットのステータス表示
  const canBlock = selectedPet.hp <= 0 ? 'HP0のため訓練不可（餌で回復）'
                 : selectedPet.hunger <= 0 ? '空腹度0のため訓練不可（餌で回復）'
                 : null;

  const statusHTML = `
    <div style="background:var(--color-white);border-radius:var(--radius-card);padding:14px;margin-bottom:14px;box-shadow:var(--shadow)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <canvas id="battle-pet-canvas" width="56" height="56" style="border-radius:10px;flex-shrink:0"></canvas>
        <div>
          <div style="font-weight:700;font-size:15px">${selectedPet.type}</div>
          <div style="font-size:11px;color:var(--color-text-light)">${selectedPet.personality} / ${selectedPet.attribute}</div>
        </div>
      </div>
      ${statBar('HP',   selectedPet.hp,      'hp')}
      ${statBar('MP',   selectedPet.mp,      'mp')}
      ${statBar('攻撃', selectedPet.attack,  'atk')}
      ${statBar('防御', selectedPet.defense, 'def')}
      ${canBlock ? `<p style="color:var(--color-hp);font-size:12px;margin-top:8px;text-align:center">${canBlock}</p>` : ''}
    </div>
  `;

  const hasLog = battleState.log.length > 0;
  area.innerHTML = petSelectHTML + diffHTML + statusHTML + `
    <button id="battle-start-btn" class="btn-primary" style="width:100%"${canBlock ? ' disabled' : ''}>
      ⚔️ 訓練開始
    </button>
    <div id="battle-log" style="margin-top:16px;background:var(--color-white);border-radius:var(--radius-card);padding:14px;box-shadow:var(--shadow);display:${hasLog ? 'block' : 'none'};max-height:200px;overflow-y:auto;font-size:13px;line-height:1.8"></div>
  `;

  // 保存済みログを復元（appendLogを使わずDOM直接追記で二重追記防止）
  if (hasLog) {
    const logEl = document.getElementById('battle-log');
    battleState.log.forEach(({ text, color }) => {
      const line = document.createElement('div');
      line.style.color = color;
      line.textContent = text;
      logEl.appendChild(line);
    });
    logEl.scrollTop = logEl.scrollHeight;
  }

  // Blob画像をcanvasに描画
  drawPetToCanvas(selectedPet, document.getElementById('battle-pet-canvas'), 56, 10);

  // ペット一覧のBlob画像を設定
  pets.forEach(p => {
    const imgEl = area.querySelector(`img[data-blob-pet="${p.id}"]`);
    if (!imgEl) return;
    const url = URL.createObjectURL(p.imageData);
    imgEl.src = url;
    imgEl.onload  = () => URL.revokeObjectURL(url);
    imgEl.onerror = () => URL.revokeObjectURL(url);
  });

  // ペット選択クリック
  area.querySelectorAll('[data-pet-id]').forEach(el => {
    el.addEventListener('click', () => {
      battleState.petId = el.dataset.petId;
      renderBattle();
    });
  });

  // 難易度選択クリック
  area.querySelectorAll('[data-diff]').forEach(el => {
    el.addEventListener('click', () => {
      battleState.difficultyId = el.dataset.diff;
      renderBattle();
    });
  });

  // 訓練開始
  document.getElementById('battle-start-btn').addEventListener('click', async () => {
    const btn = document.getElementById('battle-start-btn');
    btn.disabled = true;
    btn.textContent = '⚔️ 訓練中...';
    await executeBattle();
    btn.textContent = '⚔️ 訓練開始';
    // ペット再取得して再描画
    await renderBattle();
    await renderStatusBar();
  });
}

/** ペット画像をcanvasに描画（正方形クロップ・角丸） */
function drawPetToCanvas(pet, canvas, size, radius) {
  const url = URL.createObjectURL(pet.imageData);
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext('2d');
    const s  = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth  - s) / 2;
    const sy = (img.naturalHeight - s) / 2;
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, radius);
    ctx.clip();
    ctx.drawImage(img, sx, sy, s, s, 0, 0, size, size);
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

/** バトル実行 → ログ表示 → レベルアップ演出 */
async function executeBattle() {
  const log = document.getElementById('battle-log');
  log.style.display = 'block';
  log.innerHTML = '';
  battleState.log = []; // ログリセット

  const result = await runBattle(battleState.petId, battleState.difficultyId, battleState.enemyAttribute);

  if (!result.ok) {
    const msg = result.reason === 'HP0'      ? 'HPが0です。餌を与えてから訓練してください。'
              : result.reason === 'HUNGER0'  ? '空腹度が0です。餌を与えてから訓練してください。'
              : '訓練できません。';
    appendLog(log, msg, 'var(--color-hp)');
    return;
  }

  const diffLabel     = DIFFICULTY_LEVELS.find(d => d.id === battleState.difficultyId)?.label ?? '';
  const affinityLabel = result.affinityMult > 1.0 ? '有利' : result.affinityMult < 1.0 ? '不利' : '等倍';
  appendLog(log, `【${diffLabel}】訓練開始！ 総合力:${result.power} 難易度:${result.difficulty}`);
  appendLog(log, `敵属性: ${result.enemyAttribute} → 相性: ${affinityLabel} 勝率 ${result.winRate}%`);

  await sleep(400);

  if (result.won) {
    appendLog(log, '🎉 勝利！', 'var(--color-main)');
    appendLog(log, `HP -${result.hpLoss} / EXP +${result.expGained} / 🪙+${result.currencyGained}`);
    battleState.enemyAttribute = null; // 次回表示時に再抽選
    showBattleResultOverlay(true, result);
    if (result.leveledUp) {
      await sleep(300);
      showLevelUpOverlay(result.newLevel);
      const expanded = await tryExpandGardenSlot(result.newLevel);
      if (expanded) {
        await sleep(300);
        const user = await getUser();
        showSlotExpandOverlay(user.gardenSlots);
        await renderCage();
        await renderGarden();
      }
    }
  } else {
    appendLog(log, '💀 敗北...', 'var(--color-hp)');
    appendLog(log, `HP -${result.hpLoss}`);
    battleState.enemyAttribute = null; // 次回表示時に再抽選
    showBattleResultOverlay(false, result);
  }
}

function appendLog(container, text, color = 'var(--color-text)') {
  const line = document.createElement('div');
  line.style.color = color;
  line.textContent = text;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
  battleState.log.push({ text, color });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== 訓練結果オーバーレイ =====
async function showBattleResultOverlay(won, result) {
  let overlay = document.getElementById('overlay-battle-result');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'overlay-battle-result';
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="overlay-card">
        <h3 id="battle-result-title"></h3>
        <canvas id="battle-result-pet-canvas" width="72" height="72" style="border-radius:12px;margin:4px 0"></canvas>
        <div id="battle-result-body" style="width:100%;text-align:left;font-size:14px;line-height:2"></div>
        <button class="btn-primary" id="battle-result-ok-btn">OK</button>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  document.getElementById('battle-result-title').textContent = won ? '🎉 勝利！' : '💀 敗北...';
  document.getElementById('battle-result-title').style.color = won ? 'var(--color-main)' : 'var(--color-hp)';

  // ペット画像描画
  const pet = await getPet(battleState.petId);
  if (pet) {
    drawPetToCanvas(pet, document.getElementById('battle-result-pet-canvas'), 72, 12);
  }

  const body = document.getElementById('battle-result-body');
  const affinityLabel = result.affinityMult > 1.0 ? '⬆️ 有利' : result.affinityMult < 1.0 ? '⬇️ 不利' : '➡️ 等倍';
  const affinityColor = result.affinityMult > 1.0 ? 'var(--color-main)' : result.affinityMult < 1.0 ? 'var(--color-hp)' : 'var(--color-text-light)';
  if (won) {
    body.innerHTML = `
      <div style="font-size:12px;color:${affinityColor};margin-bottom:4px">属性相性: ${result.enemyAttribute} ${affinityLabel}</div>
      <div>HP <span style="color:var(--color-hp)">-${result.hpLoss}</span></div>
      <div>EXP <span style="color:var(--color-main)">+${result.expGained}</span></div>
      <div>🪙 <span style="color:var(--color-accent)">+${result.currencyGained}</span></div>
    `;
  } else {
    body.innerHTML = `
      <div style="font-size:12px;color:${affinityColor};margin-bottom:4px">属性相性: ${result.enemyAttribute} ${affinityLabel}</div>
      <div>HP <span style="color:var(--color-hp)">-${result.hpLoss}</span></div>
      <div style="font-size:12px;color:var(--color-text-light)">報酬なし</div>
    `;
  }

  overlay.classList.remove('hidden');
  document.getElementById('battle-result-ok-btn').onclick = () => {
    overlay.classList.add('hidden');
  };
}

// ===== T5：レベルアップ演出オーバーレイ =====
function showLevelUpOverlay(newLevel) {
  // 既存overlayを再利用（overlay-generatedと別IDにする）
  let overlay = document.getElementById('overlay-levelup');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'overlay-levelup';
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="overlay-card">
        <h3>⬆️ レベルアップ！</h3>
        <div id="levelup-info" style="font-size:28px;font-weight:700;color:var(--color-main)"></div>
        <p style="font-size:13px;color:var(--color-text-light)">難易度が上昇しました</p>
        <button class="btn-primary" id="levelup-ok-btn">OK</button>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  document.getElementById('levelup-info').textContent = `Lv.${newLevel}`;
  overlay.classList.remove('hidden');

  document.getElementById('levelup-ok-btn').onclick = () => {
    overlay.classList.add('hidden');
  };
}

// ===== 庭スロット拡張 =====

/**
 * 起動時整合チェック：現在Lvに対応する正しい gardenSlots を保証する
 * 既存データが拡張条件Lvに達しているがスロットが少ない場合に補正する
 */
async function syncGardenSlots() {
  const user = await getUser();
  const expected = Math.min(GARDEN_SLOT_MAX, 1 + GARDEN_SLOT_LEVELS.filter(lv => lv <= user.level).length);
  if (user.gardenSlots < expected) {
    user.gardenSlots = expected;
    await saveUser(user);
  }
}

/**
 * 新Lvがスロット拡張条件に該当する場合 gardenSlots を+1して保存
 * @param {number} newLevel
 * @returns {Promise<boolean>} 拡張したか否か
 */
async function tryExpandGardenSlot(newLevel) {
  if (!GARDEN_SLOT_LEVELS.includes(newLevel)) return false;
  const user = await getUser();
  if (user.gardenSlots >= GARDEN_SLOT_MAX) return false;
  user.gardenSlots = Math.min(GARDEN_SLOT_MAX, user.gardenSlots + 1);
  await saveUser(user);
  return true;
}

/** 庭スロット拡張オーバーレイを表示 */
function showSlotExpandOverlay(newSlots) {
  let overlay = document.getElementById('overlay-slot-expand');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'overlay-slot-expand';
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="overlay-card">
        <h3>🌿 庭が広がった！</h3>
        <div id="slot-expand-info" style="font-size:28px;font-weight:700;color:var(--color-main)"></div>
        <p style="font-size:13px;color:var(--color-text-light)">庭に出せるペットが増えました</p>
        <button class="btn-primary" id="slot-expand-ok-btn">OK</button>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  document.getElementById('slot-expand-info').textContent = `最大 ${newSlots} 体`;
  overlay.classList.remove('hidden');
  document.getElementById('slot-expand-ok-btn').onclick = () => {
    overlay.classList.add('hidden');
  };
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
          ctx.beginPath();
          ctx.roundRect(0, 0, 56, 56, 12);
          ctx.clip();
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
