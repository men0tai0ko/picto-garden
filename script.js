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
  panelOpenPetId = null;
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
    '★★★': '初期値・成長率高め',
    '★★':  '初期値・成長率やや高め',
    '★':   '初期値・成長率ともに標準',
  };
  const rarityStars = pet.rarity.split(' ')[0];
  const infoHTML = `
    <div class="result-row">種類: <span>${pet.type}</span></div>
    <div class="result-row">性格: <span>${pet.personality}</span></div>
    <div class="result-row">属性: <span>${pet.attribute}</span></div>
    <div class="result-row">レア度: <span>${rarityStars}</span></div>
    <div class="result-row" style="font-size:11px;color:var(--color-text-light)">${rarityDesc[rarityStars] ?? ''}</div>
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
    card.setAttribute('data-cage-card', pet.id);
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
      <span class="badge">${pet.rarity.split(' ')[0]}</span>
    `;

    const hpBar = document.createElement('div');
    hpBar.style.cssText = 'width:100%;margin-top:4px';
    hpBar.setAttribute('data-cage-statbar', '1');
    hpBar.innerHTML = cageStatBarHTML(pet);

    // 給餌ボタン（カード内インライン）
    const feedRow = document.createElement('div');
    feedRow.style.cssText = 'display:flex;gap:6px;margin-top:8px;width:100%';

    const price   = 10 * user.level;
    const feedBtn  = document.createElement('button');
    feedBtn.className = 'btn-buy';
    feedBtn.style.cssText = 'flex:1;font-size:11px;padding:6px 0';
    feedBtn.setAttribute('data-cage-feedbtn', '1');
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
      const updated = await getPet(pet.id);
      if (updated) updateCageCard(card, updated, user);
      feedBtn.disabled = false;
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
      const updated = await getPet(pet.id);
      if (updated) updateCageCard(card, updated, user);
      waterBtn.disabled = false;
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

function updateCageCard(card, pet, user) {
  const hpBar = card.querySelector('[data-cage-statbar]');
  if (!hpBar) return;
  hpBar.innerHTML = cageStatBarHTML(pet);
  // 給餌ボタン価格も更新
  const feedBtn = card.querySelector('[data-cage-feedbtn]');
  if (feedBtn) feedBtn.textContent = `🍖 餌 🪙${10 * user.level}`;
}

/** ケージカード用ステータスバーHTML生成（width クランプ済み） */
function cageStatBarHTML(pet) {
  const c = (v) => Math.min(100, Math.max(0, v));
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 8px">
      <div>
        <div style="font-size:9px;color:var(--color-text-light);margin-bottom:2px">HP ${pet.hp}</div>
        <div class="stat-bar-wrap" style="height:5px"><div class="stat-bar hp" style="width:${c(pet.hp)}%"></div></div>
      </div>
      <div>
        <div style="font-size:9px;color:var(--color-text-light);margin-bottom:2px">MP ${pet.mp}</div>
        <div class="stat-bar-wrap" style="height:5px"><div class="stat-bar mp" style="width:${c(pet.mp)}%"></div></div>
      </div>
      <div>
        <div style="font-size:9px;color:var(--color-text-light);margin-bottom:2px">攻撃 ${pet.attack}</div>
        <div class="stat-bar-wrap" style="height:5px"><div class="stat-bar atk" style="width:${c(pet.attack)}%"></div></div>
      </div>
      <div>
        <div style="font-size:9px;color:var(--color-text-light);margin-bottom:2px">防御 ${pet.defense}</div>
        <div class="stat-bar-wrap" style="height:5px"><div class="stat-bar def" style="width:${c(pet.defense)}%"></div></div>
      </div>
    </div>
    <div style="margin-top:4px">
      <div style="font-size:9px;color:var(--color-text-light);margin-bottom:2px">空腹 ${pet.hunger}</div>
      <div class="stat-bar-wrap" style="height:5px"><div class="stat-bar hunger" style="width:${c(pet.hunger)}%"></div></div>
    </div>
  `;
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

    // タップ → 下部パネル（最新データを取得して表示）
    canvas.addEventListener('click', async () => {
      const latest = await getPet(pet.id);
      if (latest) showPetPanel(latest);
    });
    petsArea.appendChild(canvas);
  }
}

// ===== 下部パネル（庭ペットタップ時） =====
/** パネルが開いているペットID（タイマーからの再描画用） */
let panelOpenPetId = null;

async function showPetPanel(pet) {
  const panel  = document.getElementById('pet-panel');
  const content = document.getElementById('panel-content');
  panelOpenPetId = pet.id;

  const user  = await getUser();
  const price = 10 * user.level;

  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <div class="panel-badge-type">${pet.type}</div>
      <div class="panel-badge-personality">${pet.personality}</div>
      <div style="font-size:12px;color:var(--color-text-light)">${pet.attribute} / ${pet.rarity.split(' ')[0]}</div>
    </div>
    <div style="font-size:11px;color:var(--color-mp);margin-bottom:8px">✨ スキル: ${pet.skill ?? '—'}</div>
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
    panelOpenPetId = null;
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

      // 庭パネルが開いていれば最新データでパネルを再描画
      if (panelOpenPetId) {
        const latest = pets.find(p => p.id === panelOpenPetId);
        if (latest) await showPetPanel(latest);
      }
      // ケージ画面が表示中であれば各カードをスクロール位置を保持したまま更新
      const cageScreen = document.getElementById('screen-cage');
      if (cageScreen.classList.contains('active')) {
        const user2 = await getUser();
        for (const pet of pets) {
          const card = cageScreen.querySelector(`[data-cage-card="${pet.id}"]`);
          if (card) updateCageCard(card, pet, user2);
        }
      }
    } catch (err) {
      console.error('空腹度タイマーエラー:', err);
    }
  }, HUNGER_INTERVAL_MS);
}

function statBar(label, value, cssClass) {
  const pct = Math.min(100, Math.max(0, value));
  return `
    <div class="panel-stat-row">
      <div class="panel-stat-label">${label}: ${value}/100</div>
      <div class="stat-bar-wrap">
        <div class="stat-bar ${cssClass}" style="width:${pct}%"></div>
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
let battleState = { difficultyId: 'normal', petId: null, log: [], enemyAttribute: null, aborted: false, session: null };

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
    // 事前ガード（訓練不可状態はボタンdisabledで防ぐが念のため）
    const petCheck = await getPet(battleState.petId);
    if (!petCheck || petCheck.hp <= 0 || petCheck.hunger <= 0) return;
    btn.disabled = true;
    btn.textContent = '⚔️ 訓練中...';
    await executeBattle();
    btn.textContent = '⚔️ 訓練開始';
    // ペット再取得して再描画（ケージも更新してHP/MP変動を反映）
    await renderBattle();
    await renderCage();
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

/** バトル実行 → ループ → 累積結果表示 */
async function executeBattle() {
  const log = document.getElementById('battle-log');
  log.style.display = 'block';
  log.innerHTML = '';
  battleState.log = [];
  battleState.aborted = false;
  battleState.session = { battles: 0, wins: 0, totalExp: 0, totalCurrency: 0 };

  const modalLog = showBattleLogModal();

  let stopReason = 'hp0'; // 'hp0' | 'hunger0' | 'aborted'
  let lastResult = null;

  // 連戦ループ
  let battleCount = 0;
  while (!battleState.aborted) {
    // 最新ペットデータで継続判定
    const petNow = await getPet(battleState.petId);
    if (!petNow || petNow.hp <= 0)     { stopReason = 'hp0';     break; }
    if (petNow.hunger <= 0)            { stopReason = 'hunger0'; break; }

    battleCount++;
    battleState.enemyAttribute = battleState.enemyAttribute ?? pickEnemyAttribute();

    // 区切り行
    const sep = `── 第${battleCount}戦 ──`;
    appendLog(log, sep, 'var(--color-text-light)');
    appendLogDOM(modalLog, sep, 'var(--color-text-light)');

    const result = await runBattle(battleState.petId, battleState.difficultyId, battleState.enemyAttribute);
    battleState.enemyAttribute = null; // 次戦で再抽選

    if (!result.ok) {
      // runBattle内ガード（念のため）
      stopReason = result.reason === 'HUNGER0' ? 'hunger0' : 'hp0';
      break;
    }

    lastResult = result;

    // ヘッダー行
    const affinityLabel = result.affinityMult > 1.0 ? '有利' : result.affinityMult < 1.0 ? '不利' : '等倍';
    appendLog(log, `敵属性: ${result.enemyAttribute} → 相性: ${affinityLabel} 勝率 ${result.winRate}%`);
    appendLogDOM(modalLog, `敵属性: ${result.enemyAttribute} → 相性: ${affinityLabel} 勝率 ${result.winRate}%`);

    // ターン行を1行ずつ時間差で表示
    for (const turn of result.turns) {
      if (battleState.aborted) break;
      await sleep(LOG_TURN_DELAY_MS);
      appendLog(log, turn.text, turn.color);
      appendLogDOM(modalLog, turn.text, turn.color);
    }

    await sleep(LOG_RESULT_DELAY_MS);

    if (result.won) {
      appendLog(log, `🎉 勝利！ HP-${result.hpLoss} / EXP+${result.expGained} / 🪙+${result.currencyGained}`, 'var(--color-main)');
      appendLogDOM(modalLog, `🎉 勝利！ HP-${result.hpLoss} / EXP+${result.expGained} / 🪙+${result.currencyGained}`, 'var(--color-main)');
    } else {
      appendLog(log, `💀 敗北... HP-${result.hpLoss}`, 'var(--color-hp)');
      appendLogDOM(modalLog, `💀 敗北... HP-${result.hpLoss}`, 'var(--color-hp)');
    }

    // session集計
    battleState.session.battles++;
    if (result.won) battleState.session.wins++;
    battleState.session.totalExp      += result.expGained;
    battleState.session.totalCurrency += result.currencyGained;

    // レベルアップ演出（連戦中も都度表示）
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

    await sleep(LOG_RESULT_DELAY_MS);

    // HP0で次戦不可になる場合はループ先頭のチェックで検出
  }

  if (battleState.aborted) stopReason = 'aborted';

  closeBattleLogModal();

  if (lastResult) {
    showBattleResultOverlay(battleState.session, stopReason, lastResult);
  }
}

// ===== バトルログモーダル =====

/**
 * バトルログ表示用モーダルを開き、ログ書き込み先のdivを返す
 * @returns {HTMLElement} ログ行を追記するdiv
 */
function showBattleLogModal() {
  let overlay = document.getElementById('overlay-battle-log');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'overlay-battle-log';
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="overlay-card" style="width:min(320px,88vw);max-height:60vh;overflow:hidden;display:flex;flex-direction:column;gap:10px">
        <h3 style="font-size:16px">⚔️ 訓練中...</h3>
        <div id="battle-log-modal-body" style="flex:1;overflow-y:auto;font-size:13px;line-height:2;text-align:left;min-height:80px"></div>
        <button class="btn-primary" id="battle-abort-btn" style="background:var(--color-hp);padding:8px 20px;font-size:13px">中断</button>
      </div>
    `;
    document.body.appendChild(overlay);
  }
  document.getElementById('battle-abort-btn').onclick = () => {
    battleState.aborted = true;
  };
  const body = document.getElementById('battle-log-modal-body');
  body.innerHTML = '';
  overlay.classList.remove('hidden');
  return body;
}

/** バトルログモーダルを閉じる */
function closeBattleLogModal() {
  const overlay = document.getElementById('overlay-battle-log');
  if (overlay) overlay.classList.add('hidden');
}

function appendLog(container, text, color = 'var(--color-text)') {
  const line = document.createElement('div');
  line.style.color = color;
  line.textContent = text;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
  battleState.log.push({ text, color });
}

/** battleState.logへの保存なし（モーダル専用） */
function appendLogDOM(container, text, color = 'var(--color-text)') {
  const line = document.createElement('div');
  line.style.color = color;
  line.textContent = text;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

/** ターン行待機・結果行待機（ms） */
const LOG_TURN_DELAY_MS   = 600;
const LOG_RESULT_DELAY_MS = 300;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== 訓練結果オーバーレイ =====
async function showBattleResultOverlay(session, stopReason, lastResult) {
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

  // タイトル：勝利数/総戦闘数
  const titleEl = document.getElementById('battle-result-title');
  titleEl.textContent = `${session.wins}勝 / ${session.battles}戦`;
  titleEl.style.color = session.wins > 0 ? 'var(--color-main)' : 'var(--color-hp)';

  // ペット画像描画
  const pet = await getPet(battleState.petId);
  if (pet) {
    drawPetToCanvas(pet, document.getElementById('battle-result-pet-canvas'), 72, 12);
  }

  // 停止理由ラベル
  const stopLabel = stopReason === 'hp0'     ? '⚠️ HPが0になりました'
                  : stopReason === 'hunger0' ? '⚠️ 空腹度が0になりました'
                  : '🛑 中断しました';
  const stopColor = stopReason === 'aborted' ? 'var(--color-text-light)' : 'var(--color-hp)';

  document.getElementById('battle-result-body').innerHTML = `
    <div style="font-size:12px;color:${stopColor};margin-bottom:6px">${stopLabel}</div>
    <div>HP <span style="color:var(--color-hp)">-${lastResult.hpLoss}</span><span style="font-size:11px;color:var(--color-text-light)">（最終戦）</span></div>
    <div>EXP <span style="color:var(--color-main)">+${session.totalExp}</span></div>
    <div>🪙 <span style="color:var(--color-accent)">+${session.totalCurrency}</span></div>
  `;

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
