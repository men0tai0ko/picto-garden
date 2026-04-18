/**
 * script.js — エントリポイント
 * T1：ペット生成UI・画面遷移・ステータスバー・ケージ表示・図鑑表示
 * T2：庭表示・下部パネル
 * T3：餌システム（ショップUI・餌購入・ステータス上昇）
 * T4：訓練画面UI・オートバトル
 * T5：報酬ループ（EXP・レベルアップ・レベルアップ演出）
 */

import { initDB, getUser, saveUser, getAllPets, getPet, savePet, registerNewPet, deletePet, syncHousingData } from './state.js';
import { generatePetFromImage, PET_TYPES, PERSONALITIES, SKILLS, breedPet, BREED_COST_MULTIPLIER, BREED_HUNGER_MIN, BREED_PET_CAP, BREED_EVOLUTION_MIN } from './petGenerator.js';
import { spendCurrency, earnCurrency } from './economy.js';
import { runBattle, DIFFICULTY_LEVELS, pickEnemyAttribute, getAffinityMultiplier, ENEMY_ATTRIBUTES } from './battle.js';

// ===== 庭 時刻帯演出 =====
/** 庭の時刻帯クラス更新インターバル管理 */
let gardenTimeInterval = null;

/** 現在時刻から時刻帯クラス名を返す（morning/noon/evening/night） */
function getCurrentTimeSlot() {
  const h = new Date().getHours();
  if (h >= 6  && h < 12) return 'time-morning';
  if (h >= 12 && h < 18) return 'time-noon';
  if (h >= 18 && h < 22) return 'time-evening';
  return 'time-night';
}

/** #screen-garden の time-* クラスを現在時刻帯に合わせて付け替える */
function applyGardenTime() {
  const garden = document.getElementById('screen-garden');
  if (!garden) return;
  garden.classList.remove('time-morning', 'time-noon', 'time-evening', 'time-night');
  garden.classList.add(getCurrentTimeSlot());
}

/** 進化段階 → CSSクラス名変換（呼び出し元でのクラス付与に使用） */
function getEvolutionClass(stage) {
  if (stage >= 2) return 'evo-stage-2';
  if (stage >= 1) return 'evo-stage-1';
  return '';
}

/**
 * 要素をpet-icon-wrapで包み、generation>=1なら世代バッジを追加して返す
 * @param {HTMLElement} iconEl - canvasまたはimg
 * @param {number} generation
 * @returns {HTMLElement} wrap（バッジなし時はwrapのみ）
 */
function wrapWithGenerationBadge(iconEl, generation) {
  const wrap = document.createElement('div');
  wrap.className = 'pet-icon-wrap';
  wrap.appendChild(iconEl);
  if (generation >= 1) {
    const badge = document.createElement('span');
    badge.className = 'generation-badge';
    badge.textContent = `${generation}世`;
    wrap.appendChild(badge);
  }
  return wrap;
}

// ===== 起動 =====
(async () => {
  try {
    await initDB();
    await syncRarity();
    await syncGardenSlots();
    await syncHousingData();
    await renderStatusBar();
    await renderEncyclopedia();
    await renderCage();
    await renderGarden();
    await renderShop();
    await renderBattle();
    initNavigation();
    initGenerateScreen();
    initGardenFooter();
    initCageFooterCancelButtons();
    switchScreen('garden');
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
  // フッター表示制御
  document.body.classList.toggle('screen-cage',     name === 'cage');
  document.body.classList.toggle('screen-garden',   name === 'garden');
  document.body.classList.toggle('screen-generate', name === 'generate');
  document.body.classList.toggle('screen-breed',    name === 'breed');
  // 庭以外に切替時はトレイ・配置モードを閉じる
  if (name !== 'garden') closeItemTray();
  // 画面切替時にステータスパネルを閉じる
  const panel = document.getElementById('pet-panel');
  panel.classList.remove('open');
  panel.classList.add('hidden');
  panelOpenPetId = null;
  // 生成画面：庭スロット満杯警告
  if (name === 'generate') renderGenerateWarning();
  // 庭の時刻帯演出：庭進入時に開始、離脱時に停止
  clearInterval(gardenTimeInterval);
  gardenTimeInterval = null;
  if (name === 'garden') {
    applyGardenTime();
    gardenTimeInterval = setInterval(applyGardenTime, 60_000);
  }
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
    '伝説': '初期値・成長率非常に高め',
    '英雄': '初期値・成長率高め',
    '希少': '初期値・成長率やや高め',
    '高級': '初期値・成長率ともに標準',
    '一般': '初期値・成長率ともに控えめ',
  };
  const infoHTML = `
    <div class="result-row">種類: <span>${pet.type}</span></div>
    <div class="result-row">性格: <span>${pet.personality}</span></div>
    <div class="result-row">属性: <span>${pet.attribute}</span></div>
    <div class="result-row">等級: <span>${pet.rarity}</span></div>
    <div class="result-row" style="font-size:11px;color:var(--color-text-light)">${rarityDesc[pet.rarity] ?? ''}</div>
    <div class="result-row">HP: <span>${pet.hp}</span> / MP: <span>${pet.mp}</span></div>
    <div class="result-row">攻撃: <span>${pet.attack}</span> / 防御: <span>${pet.defense}</span></div>
  `;
  infoArea.insertAdjacentHTML('beforeend', infoHTML);

  overlay.classList.remove('hidden');

  const closeGenerated = () => {
    overlay.classList.add('hidden');
    URL.revokeObjectURL(blobUrl);
    switchScreen('cage');
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.screen === 'cage');
    });
  };
  document.getElementById('overlay-ok-btn').onclick = closeGenerated;
  overlay.onclick = (e) => { if (e.target === overlay) closeGenerated(); };
}

// ===== ケージ =====
/** ケージ編集モード（trueのとき削除ボタンを表示） */
let cageEditMode = false;

async function renderCage() {
  const grid = document.getElementById('cage-grid');
  grid.innerHTML = '';

  // タイトル行（編集ボタンなし・シンプル化）
  let titleRow = document.querySelector('#screen-cage .cage-title-row');
  if (!titleRow) {
    const screenCage = document.getElementById('screen-cage');
    const existingTitle = screenCage.querySelector('.screen-title');
    titleRow = document.createElement('div');
    titleRow.className = 'cage-title-row';
    titleRow.style.cssText = 'display:flex;align-items:center;padding:16px 16px 8px';
    const titleEl = document.createElement('h2');
    titleEl.style.cssText = 'font-size:18px;font-weight:700;color:var(--color-text)';
    titleEl.textContent = 'ケージ';
    titleRow.append(titleEl);
    if (existingTitle) existingTitle.replaceWith(titleRow);
    else screenCage.insertBefore(titleRow, screenCage.firstChild);
  }

  const user = await getUser();
  const pets = await getAllPets();

  // ペット上限警告バナー
  const screenCage = document.getElementById('screen-cage');
  let capBanner = document.getElementById('cage-cap-banner');
  if (pets.length >= BREED_PET_CAP) {
    if (!capBanner) {
      capBanner = document.createElement('p');
      capBanner.id = 'cage-cap-banner';
      capBanner.style.cssText = 'color:var(--color-hp);font-size:12px;text-align:center;background:rgba(232,84,84,0.1);border-radius:8px;padding:8px 12px;margin:0 16px 8px';
      const titleRowEl = screenCage.querySelector('.cage-title-row');
      if (titleRowEl) titleRowEl.after(capBanner);
    }
    capBanner.textContent = `⚠️ ペットの所持上限（${pets.length}/${BREED_PET_CAP}体）に達しています`;
    capBanner.hidden = false;
  } else if (capBanner) {
    capBanner.hidden = true;
  }

  pets.forEach(pet => {
    const card = document.createElement('div');
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
    const evoClass = getEvolutionClass(pet.evolutionStage ?? 0);
    if (evoClass) imgEl.classList.add(evoClass);

    // 名前
    const name = document.createElement('div');
    name.className   = 'cage-card-name';
    name.setAttribute('data-cage-name', '1');
    name.textContent = pet.name ?? pet.type;

    card.append(wrapWithGenerationBadge(imgEl, pet.generation ?? 0), name);

    // 編集モード時のみ削除ボタンを追加
    if (cageEditMode) {
      const inGarden = user.gardenPetIds.includes(pet.id);
      const releaseBtn = document.createElement('button');
      releaseBtn.style.cssText = `width:100%;margin-top:6px;padding:6px 0;border-radius:var(--radius-btn);border:none;font-size:11px;font-weight:700;cursor:${inGarden ? 'not-allowed' : 'pointer'};background:${inGarden ? 'var(--color-bg)' : 'rgba(232,84,84,0.12)'};color:${inGarden ? 'var(--color-text-light)' : 'var(--color-hp)'}`;
      releaseBtn.textContent = inGarden ? '🏡 庭から外してください' : '🌿 野に放つ';
      releaseBtn.disabled = inGarden;
      releaseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (inGarden) return;
        showReleaseConfirmDialog(pet);
      });
      card.appendChild(releaseBtn);
    }

    // カードタップ：ステータスパネルを表示
    card.addEventListener('click', () => showPetPanel(pet));

    grid.appendChild(card);
  });

  // ===== cage-footer ボタン初期化・状態更新 =====
  const btnGenerate = document.getElementById('cage-btn-generate');
  const btnBreed    = document.getElementById('cage-btn-breed');
  const btnEdit     = document.getElementById('cage-btn-edit');

  // 繁殖：ペット2体未満はdisabled
  btnBreed.disabled = pets.length < 2;

  // 編集：モードに応じてラベル・active切替
  btnEdit.textContent = '';
  btnEdit.innerHTML = `${cageEditMode ? '✅' : '✏️'}<span>${cageEditMode ? '完了' : '編集'}</span>`;
  btnEdit.classList.toggle('active', cageEditMode);

  // イベントは毎回上書きで登録（onclick使用）
  btnGenerate.onclick = () => {
    switchScreen('generate');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  };
  btnBreed.onclick = () => {
    if (pets.length < 2) return;
    switchScreen('breed');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    renderBreedScreen();
  };
  btnEdit.onclick = () => {
    cageEditMode = !cageEditMode;
    renderCage();
  };
}

function updateCageCard(card, pet, user) {
  const hpBar = card.querySelector('[data-cage-statbar]');
  if (!hpBar) return;
  hpBar.innerHTML = cageStatBarHTML(pet);
  // 名前更新（リネームバグ修正）
  const nameEl = card.querySelector('[data-cage-name]');
  if (nameEl) nameEl.textContent = pet.name ?? pet.type;
  // 給餌ボタン価格も更新
  const feedBtn = card.querySelector('[data-cage-feedbtn]');
  if (feedBtn) feedBtn.textContent = `🍖 餌 🪙${10 * user.level}`;
  // ペット画像を進化後BlobURLで更新
  const imgEl = card.querySelector('img');
  if (imgEl && pet.imageData) {
    const url = URL.createObjectURL(pet.imageData);
    imgEl.onload  = () => URL.revokeObjectURL(url);
    imgEl.onerror = () => URL.revokeObjectURL(url);
    imgEl.src = url;
    imgEl.classList.remove('evo-stage-1', 'evo-stage-2');
    const evoClass = getEvolutionClass(pet.evolutionStage ?? 0);
    if (evoClass) imgEl.classList.add(evoClass);
  }
}

/** ケージカード用ステータスバーHTML生成（width クランプ済み） */
function cageStatBarHTML(pet) {
  const c = (v, cap) => Math.min(100, Math.max(0, (v / (cap ?? 100)) * 100));
  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 8px">
      <div>
        <div style="font-size:9px;color:var(--color-text-light);margin-bottom:2px">HP ${pet.hp}</div>
        <div class="stat-bar-wrap" style="height:5px"><div class="stat-bar hp" style="width:${c(pet.hp, pet.statCaps?.hp)}%"></div></div>
      </div>
      <div>
        <div style="font-size:9px;color:var(--color-text-light);margin-bottom:2px">MP ${pet.mp}</div>
        <div class="stat-bar-wrap" style="height:5px"><div class="stat-bar mp" style="width:${c(pet.mp, pet.statCaps?.mp)}%"></div></div>
      </div>
      <div>
        <div style="font-size:9px;color:var(--color-text-light);margin-bottom:2px">攻撃 ${pet.attack}</div>
        <div class="stat-bar-wrap" style="height:5px"><div class="stat-bar atk" style="width:${c(pet.attack, pet.statCaps?.attack)}%"></div></div>
      </div>
      <div>
        <div style="font-size:9px;color:var(--color-text-light);margin-bottom:2px">防御 ${pet.defense}</div>
        <div class="stat-bar-wrap" style="height:5px"><div class="stat-bar def" style="width:${c(pet.defense, pet.statCaps?.defense)}%"></div></div>
      </div>
    </div>
    <div style="margin-top:4px">
      <div style="font-size:9px;color:var(--color-text-light);margin-bottom:2px">満腹 ${pet.hunger}</div>
      <div class="stat-bar-wrap" style="height:5px"><div class="stat-bar hunger" style="width:${c(pet.hunger, 100)}%"></div></div>
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
    sub.textContent = `HP ${pet.hp} / 満腹 ${pet.hunger}`;
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

  // 配置済みアイテムを描画（ペットより後に追加してz-indexで制御）
  const gardenScreen = document.getElementById('screen-garden');
  gardenScreen.querySelectorAll('.garden-item').forEach(el => el.remove());
  (user.placedItems ?? []).forEach(placed => {
    const def = ITEM_CATALOG.find(it => it.id === placed.itemId);
    if (!def) return;
    const baseSize = ITEM_BASE_SIZE[def.category] ?? 48;
    const size = Math.round(baseSize * placed.sizeScale);
    const el = document.createElement('div');
    el.className = 'garden-item';
    el.dataset.uid = placed.uid;
    el.innerHTML = def.svg;
    el.querySelector('svg').style.cssText = `width:${size}px;height:${size}px;display:block`;
    // 初期位置：%指定（getBoundingClientRect不要・非表示時でも正確）
    el.style.cssText = `left:${placed.x}%;top:${placed.y}%;z-index:${Math.round(placed.y * 1.5 + 10)}`;

    // ポインタダウン → 長押し削除 / ドラッグ移動 の判別
    let pressTimer  = null;
    let isDragging  = false;
    let dragOffX    = 0;
    let dragOffY    = 0;

    const onDown = (e) => {
      if (document.body.classList.contains('housing-place-mode')) return;
      e.stopPropagation();
      isDragging = false;
      const rect = gardenScreen.getBoundingClientRect();
      // %指定の現在位置をpxに変換してオフセット計算
      dragOffX = (parseFloat(el.style.left) / 100 * rect.width)  - (e.clientX - rect.left);
      dragOffY = (parseFloat(el.style.top)  / 100 * rect.height) - (e.clientY - rect.top);

      pressTimer = setTimeout(async () => {
        isDragging = false;
        const u = await getUser();
        const idx = (u.placedItems ?? []).findIndex(p => p.uid === placed.uid);
        if (idx >= 0) {
          u.placedItems.splice(idx, 1);
          const own = u.ownedItems?.find(o => o.itemId === placed.itemId);
          if (own) own.qty += 1; else (u.ownedItems = u.ownedItems ?? []).push({ itemId: placed.itemId, qty: 1 });
          await saveUser(u);
          await renderGarden();
        }
      }, 600);

      el.setPointerCapture(e.pointerId);
    };

    const FOOTER_H = 52; // garden-footerの高さ（style.css固定値）

    const onMove = (e) => {
      if (document.body.classList.contains('housing-place-mode')) return;
      if (!pressTimer && !isDragging) return;
      const rect = gardenScreen.getBoundingClientRect();
      const curPx = e.clientX - rect.left;
      const curPy = e.clientY - rect.top;
      const itemPx = parseFloat(el.style.left) / 100 * rect.width;
      const itemPy = parseFloat(el.style.top)  / 100 * rect.height;
      const dx = (curPx + dragOffX) - itemPx;
      const dy = (curPy + dragOffY) - itemPy;
      if (!isDragging && Math.abs(dx) + Math.abs(dy) > 5) {
        isDragging = true;
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      if (isDragging) {
        const newPx = Math.max(0, Math.min(rect.width  - size, curPx + dragOffX));
        const newPy = Math.max(0, Math.min(rect.height - FOOTER_H - size, curPy + dragOffY));
        el.style.left = `${newPx / rect.width  * 100}%`;
        el.style.top  = `${newPy / rect.height * 100}%`;
      }
    };

    const onUp = async (e) => {
      if (document.body.classList.contains('housing-place-mode')) return;
      clearTimeout(pressTimer);
      pressTimer = null;
      if (!isDragging) return;
      isDragging = false;

      const rect = gardenScreen.getBoundingClientRect();
      const yMinPx = GARDEN_Y_MIN / 100 * rect.height;
      const newPx = Math.max(0, Math.min(rect.width  - size, e.clientX - rect.left + dragOffX));
      const newPy = Math.max(yMinPx, Math.min(rect.height - FOOTER_H - size, e.clientY - rect.top  + dragOffY));
      const newX = Math.round((newPx / rect.width)  * 1000) / 10;
      const newY = Math.round((newPy / rect.height) * 1000) / 10;
      const newScale = DEPTH_SCALE_MIN + (newY - GARDEN_Y_MIN) / (100 - GARDEN_Y_MIN) * (DEPTH_SCALE_MAX - DEPTH_SCALE_MIN);

      const u = await getUser();
      const target = (u.placedItems ?? []).find(p => p.uid === placed.uid);
      if (target) {
        target.x = newX;
        target.y = newY;
        target.sizeScale = newScale;
        await saveUser(u);
      }
      await renderGarden();
    };

    const onCancel = () => { clearTimeout(pressTimer); pressTimer = null; isDragging = false; };

    el.addEventListener('pointerdown',   onDown);
    el.addEventListener('pointermove',   onMove);
    el.addEventListener('pointerup',     onUp);
    el.addEventListener('pointercancel', onCancel);
    gardenScreen.appendChild(el);
  });

  if (user.gardenPetIds.length === 0) {
    emptyMsg.hidden = false;
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

    const canvas  = document.createElement('canvas');
    const SIZE    = 80;
    const RADIUS  = 16;
    canvas.width  = SIZE;
    canvas.height = SIZE;
    canvas.className = `garden-pet ${PET_TYPES[pet.typeIndex]?.animClass ?? ''} ${getEvolutionClass(pet.evolutionStage ?? 0)}`.trimEnd();
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', pet.type);
    canvas.style.zIndex = '50';

    const blobUrl = URL.createObjectURL(pet.imageData);
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      const s  = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth  - s) / 2;
      const sy = (img.naturalHeight - s) / 2;
      ctx.beginPath();
      ctx.roundRect(0, 0, SIZE, SIZE, RADIUS);
      ctx.clip();
      ctx.drawImage(img, sx, sy, s, s, 0, 0, SIZE, SIZE);
      URL.revokeObjectURL(blobUrl);
    };
    img.onerror = () => URL.revokeObjectURL(blobUrl);
    img.src = blobUrl;

    // タップ → 下部パネル（配置モード中は無効）
    canvas.addEventListener('click', async () => {
      if (document.body.classList.contains('housing-place-mode')) return;
      const latest = await getPet(pet.id);
      if (latest) showPetPanel(latest);
    });

    const petWrapper = document.createElement('div');
    petWrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px;position:relative;z-index:50';
    const nameLabel = document.createElement('div');
    nameLabel.style.cssText = 'font-size:10px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.6);font-weight:700;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center';
    nameLabel.textContent = pet.name ?? pet.type;
    petWrapper.append(wrapWithGenerationBadge(canvas, pet.generation ?? 0), nameLabel);
    petsArea.appendChild(petWrapper);
  }
}

// ===== 下部パネル（庭ペットタップ時） =====
/** パネルが開いているペットID（タイマーからの再描画用） */
let panelOpenPetId = null;

/** ランダム名称リスト（ひらがな形容詞＋カタカナ名詞・petGeneratorと同形式） */
const RANDOM_PET_NAMES = [
  'あかいトラ', 'あおいリュウ', 'しろいホシ', 'くろいカゼ', 'きいろヒカリ',
  'つよいウミ', 'はやいモリ', 'やさしイワ', 'かわいクモ', 'ひかるナミ',
  'するどキバ', 'こわいツメ', 'しずかタマ', 'おおきホノ', 'ふかいコオリ',
  'たかいムシ', 'にぎやハナ', 'ちいさツキ', 'にぶいカミ', 'ふるいタイヨ',
  'くろいリュウ', 'あおいウミ', 'しろいモリ', 'つよいホシ',
];

async function showPetPanel(pet) {
  const panel  = document.getElementById('pet-panel');
  const content = document.getElementById('panel-content');
  panelOpenPetId = pet.id;

  const user  = await getUser();
  const price = 10 * user.level;

  const inGarden   = user.gardenPetIds.includes(pet.id);
  const gardenFull = !inGarden && user.gardenPetIds.length >= user.gardenSlots;
  content.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <canvas id="panel-pet-canvas" width="48" height="48" style="border-radius:10px;flex-shrink:0"></canvas>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px">
          <span id="panel-pet-name" style="font-size:16px;font-weight:700;color:var(--color-text)">${pet.name ?? pet.type}</span>
          <button id="panel-rename-btn" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--color-text-light);padding:2px 4px" aria-label="名前を変更">✏️</button>
          <button id="panel-random-name-btn" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--color-text-light);padding:2px 4px" aria-label="ランダムな名前">🎲</button>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <div class="panel-badge-type">${pet.type}</div>
          <div class="panel-badge-personality">${pet.personality}</div>
          <div class="panel-badge-attribute">${pet.attribute}</div>
          <div class="panel-badge-rarity">${pet.rarity}</div>
        </div>
      </div>
    </div>
    <div style="font-size:11px;color:var(--color-mp);margin-bottom:8px">✨ スキル: ${SKILLS.find(s => s.id === pet.skill)?.label ?? pet.skill ?? '—'}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-bottom:6px">
      ${statBar('HP',    pet.hp,     'hp',  pet.statCaps?.hp      ?? 100)}
      ${statBar('MP',    pet.mp,     'mp',  pet.statCaps?.mp      ?? 100)}
      ${statBar('攻撃',  pet.attack, 'atk', pet.statCaps?.attack  ?? 100)}
      ${statBar('防御',  pet.defense,'def', pet.statCaps?.defense ?? 100)}
    </div>
    ${statBar('満腹度', pet.hunger, 'hunger')}
    <div style="margin-top:14px;display:flex;gap:10px;justify-content:center">
      <button class="btn-primary" id="panel-feed-btn" style="padding:10px 20px;font-size:14px">🍖 餌 🪙${price}</button>
      <button class="btn-primary" id="panel-water-btn" style="padding:10px 20px;font-size:14px;background:var(--color-mp)">💧 おみず</button>
    </div>
    <button id="panel-garden-btn" class="btn-primary" style="width:100%;margin-top:10px;font-size:14px;background:${inGarden ? 'var(--color-ground)' : gardenFull ? '#aaa' : 'var(--color-main)'}"
      ${gardenFull ? 'disabled' : ''}>
      ${inGarden ? '🏡 庭から外す' : gardenFull ? '🌿 庭がいっぱい' : '🌿 庭に出す'}
    </button>
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
    if (document.body.classList.contains('screen-breed')) await _renderBreedArea();
    const updated = await getPet(pet.id);
    if (updated) showPetPanel(updated);
    if (result.evolved) showEvolutionOverlay(updated ?? fresh, result.evolutionStage);
  });

  document.getElementById('panel-water-btn').addEventListener('click', async () => {
    const btn = document.getElementById('panel-water-btn');
    btn.disabled = true;
    const fresh = await getPet(pet.id);
    if (!fresh) { btn.disabled = false; return; }
    await waterPet(fresh);
    await renderStatusBar();
    await renderGarden();
    await renderCage();
    if (document.body.classList.contains('screen-breed')) await _renderBreedArea();
    const updated = await getPet(pet.id);
    if (updated) showPetPanel(updated);
  });

  // ペットアイコン描画
  const panelCanvas = document.getElementById('panel-pet-canvas');
  drawPetToCanvas(pet, panelCanvas, 48, 8);
  const panelEvoClass = getEvolutionClass(pet.evolutionStage ?? 0);
  if (panelEvoClass) panelCanvas.classList.add(panelEvoClass);
  // 世代バッジをcanvasの親要素に追加
  if ((pet.generation ?? 0) >= 1) {
    const panelWrap = panelCanvas.parentElement;
    if (panelWrap && !panelWrap.querySelector('.generation-badge')) {
      panelWrap.style.position = 'relative';
      const badge = document.createElement('span');
      badge.className = 'generation-badge';
      badge.textContent = `${pet.generation}世`;
      panelWrap.appendChild(badge);
    }
  }

  // サイコロボタン：ランダム名をIndexedDBに保存してパネル再描画
  document.getElementById('panel-random-name-btn').addEventListener('click', async () => {
    const fresh = await getPet(pet.id);
    if (!fresh) return;
    fresh.name = RANDOM_PET_NAMES[Math.floor(Math.random() * RANDOM_PET_NAMES.length)];
    await savePet(fresh);
    await renderGarden();
    showPetPanel(fresh);
  });

  // リネームボタン
  document.getElementById('panel-rename-btn').addEventListener('click', () => {
    const nameEl  = document.getElementById('panel-pet-name');
    const current = nameEl.textContent;
    const input   = document.createElement('input');
    input.type      = 'text';
    input.value     = current;
    input.maxLength = 6;
    input.style.cssText = 'font-size:16px;font-weight:700;border:none;border-bottom:2px solid var(--color-main);outline:none;width:120px;background:transparent;color:var(--color-text)';
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    /** バリデーション：日本語＋英数字のみ・1〜6文字 */
    const NAME_PATTERN = /^[\u3040-\u30FF\u4E00-\u9FFF\uFF00-\uFFEFa-zA-Z0-9０-９]+$/;

    const commit = async () => {
      const val = input.value.trim();
      const newName = (val && NAME_PATTERN.test(val)) ? val.slice(0, 6) : current;
      const fresh = await getPet(pet.id);
      if (fresh) {
        fresh.name = newName;
        await savePet(fresh);
        await renderGarden();
        await renderCage();
        showPetPanel(fresh);
      }
    };
    input.addEventListener('blur',    commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { input.blur(); }
      if (e.key === 'Escape') { input.value = current; input.blur(); }
    });
  });

  // 庭に出す / 外すボタン
  document.getElementById('panel-garden-btn').addEventListener('click', async () => {
    const btn = document.getElementById('panel-garden-btn');
    btn.disabled = true;
    const u = await getUser();
    const idx = u.gardenPetIds.indexOf(pet.id);
    if (idx >= 0) {
      u.gardenPetIds.splice(idx, 1);
    } else {
      if (u.gardenPetIds.length >= u.gardenSlots) {
        showEvictDialog(u, pet.id, null);
        btn.disabled = false;
        return;
      }
      u.gardenPetIds.push(pet.id);
    }
    await saveUser(u);
    await renderGarden();
    await renderCage();
    const updated = await getPet(pet.id);
    if (updated) showPetPanel(updated);
  });

  document.getElementById('panel-close').onclick = () => {
    panel.classList.remove('open');
    panel.classList.add('hidden');
    panelOpenPetId = null;
  };
}

// ===== 満腹度時間経過減少（tasks.md 改善提案・仕様#8） =====

/** 満腹度減少間隔（ms）・1回の減少量 */
const HUNGER_INTERVAL_MS  = 5 * 60 * 1000; // 5分
const HUNGER_DECREASE_VAL = 5;

/** 放置収益：ペット1体あたりの基本係数・1回あたり上限 */
const IDLE_INCOME_PER_PET = 1;
const IDLE_INCOME_CAP     = 50;

/** 庭スロット拡張：拡張発生Lv一覧・上限 */
const GARDEN_SLOT_LEVELS = [10, 20, 30, 40];
const GARDEN_SLOT_MAX    = 5;

/** 起動時に開始。全ペットの満腹度を定期減算しIndexedDB保存 */
function startHungerTimer() {
  setInterval(async () => {
    try {
      const pets = await getAllPets();
      for (const pet of pets) {
        if (pet.hunger <= 0) continue;
        pet.hunger = Math.max(0, pet.hunger - HUNGER_DECREASE_VAL);
        // 自然回復（満腹度>0のペットのみ・個性上限反映）
        const hpCap = pet.statCaps?.hp ?? STAT_CAP;
        const mpCap = pet.statCaps?.mp ?? STAT_CAP;
        pet.hp = Math.min(hpCap, (pet.hp ?? 0) + 5);
        pet.mp = Math.min(mpCap, (pet.mp ?? 0) + 5);
        await savePet(pet);
      }

      // ===== 放置収益 =====
      const user = await getUser();
      // 庭在中かつ満腹度 > 0 のペット数をカウント
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
      console.error('満腹度タイマーエラー:', err);
    }
  }, HUNGER_INTERVAL_MS);
}

function statBar(label, value, cssClass, cap = 100) {
  const pct = Math.min(100, Math.max(0, (value / cap) * 100));
  return `
    <div class="panel-stat-row">
      <div class="panel-stat-label">${label}: ${value}/${cap}</div>
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
  '伝説': 0.30,
  '英雄': 0.20,
  '希少': 0.10,
  '高級': 0.05,
  '一般': 0.02,
};

/** 通常成長：+1〜+5 */
const STAT_GROWTH_MIN = 1;
const STAT_GROWTH_MAX = 5;

/** 餌の満腹回復量 */
const FEED_HUNGER_RESTORE = 20;

/** ステータス上限 */
const STAT_CAP = 100;

// ===== ハウジング定数 =====

/** アイテム配置合計上限 */
const HOUSING_TOTAL_CAP = 20;

/** カテゴリ別baseSize（px） */
const ITEM_BASE_SIZE = { building: 64, plant: 48, item: 36 };

/** 奥行き：配置可能Y下限（草原上端）・スケール範囲 */
const GARDEN_Y_MIN      = 33;   // 配置可能エリア上端（%）
const DEPTH_SCALE_MIN   = 0.5;  // Y=GARDEN_Y_MIN 時のスケール（遠）
const DEPTH_SCALE_MAX   = 1.5;  // Y=100 時のスケール（近）

/**
 * アイテム定数テーブル
 * svg: viewBox="0 0 64 64" のSVGパス文字列
 */
const ITEM_CATALOG = [
  // 建物（maxQty=1）
  {
    id: 'building_cabin', name: '木の小屋', category: 'building', price: 150, maxQty: 1,
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="10" y="32" width="44" height="26" rx="2" fill="#C4956A"/>
      <polygon points="4,34 32,10 60,34" fill="#8B5E3C"/>
      <rect x="26" y="42" width="12" height="16" rx="1" fill="#6B3F1F"/>
      <rect x="12" y="36" width="10" height="10" rx="1" fill="#C8E6F5"/>
      <rect x="42" y="36" width="10" height="10" rx="1" fill="#C8E6F5"/>
    </svg>`,
  },
  {
    id: 'building_tower', name: '石の塔', category: 'building', price: 150, maxQty: 1,
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="18" y="20" width="28" height="40" rx="2" fill="#9A8870"/>
      <rect x="14" y="16" width="36" height="8" rx="1" fill="#7A6850"/>
      <rect x="10" y="10" width="8" height="14" rx="1" fill="#7A6850"/>
      <rect x="46" y="10" width="8" height="14" rx="1" fill="#7A6850"/>
      <rect x="28" y="14" width="8" height="14" rx="1" fill="#7A6850"/>
      <rect x="26" y="38" width="12" height="22" rx="1" fill="#6B3F1F"/>
      <rect x="22" y="28" width="8" height="8" rx="1" fill="#C8E6F5"/>
      <rect x="34" y="28" width="8" height="8" rx="1" fill="#C8E6F5"/>
    </svg>`,
  },
  {
    id: 'building_tent', name: 'テント', category: 'building', price: 150, maxQty: 1,
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <polygon points="32,8 6,56 58,56" fill="#F0A830"/>
      <polygon points="32,8 20,56 44,56" fill="#E8923A"/>
      <rect x="24" y="42" width="16" height="14" rx="1" fill="#6B3F1F"/>
    </svg>`,
  },
  {
    id: 'building_windmill', name: '風車', category: 'building', price: 150, maxQty: 1,
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="28" y="20" width="8" height="40" rx="2" fill="#C4956A"/>
      <circle cx="32" cy="22" r="6" fill="#9A8870"/>
      <rect x="30" y="4" width="4" height="18" rx="2" fill="#7DB87A"/>
      <rect x="14" y="20" width="18" height="4" rx="2" fill="#7DB87A"/>
      <rect x="30" y="22" width="4" height="18" rx="2" fill="#7DB87A"/>
      <rect x="32" y="20" width="18" height="4" rx="2" fill="#7DB87A"/>
    </svg>`,
  },
  {
    id: 'building_castle', name: 'お城', category: 'building', price: 150, maxQty: 1,
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="14" y="28" width="36" height="32" rx="1" fill="#B4B2A9"/>
      <rect x="8" y="20" width="12" height="20" rx="1" fill="#9A8870"/>
      <rect x="44" y="20" width="12" height="20" rx="1" fill="#9A8870"/>
      <rect x="8" y="14" width="4" height="8" rx="1" fill="#9A8870"/>
      <rect x="16" y="14" width="4" height="8" rx="1" fill="#9A8870"/>
      <rect x="44" y="14" width="4" height="8" rx="1" fill="#9A8870"/>
      <rect x="52" y="14" width="4" height="8" rx="1" fill="#9A8870"/>
      <rect x="26" y="40" width="12" height="20" rx="1" fill="#6B3F1F"/>
      <polygon points="32,6 22,20 42,20" fill="#E85454"/>
    </svg>`,
  },
  // 植物（複数購入可）
  {
    id: 'plant_sakura', name: '桜の木', category: 'plant', price: 80, maxQty: null,
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="28" y="36" width="8" height="24" rx="3" fill="#C4956A"/>
      <circle cx="32" cy="26" r="18" fill="#F4A0B0"/>
      <circle cx="20" cy="30" r="12" fill="#F0B8C4"/>
      <circle cx="44" cy="30" r="12" fill="#F0B8C4"/>
      <circle cx="32" cy="14" r="10" fill="#F0B8C4"/>
    </svg>`,
  },
  {
    id: 'plant_cactus', name: 'サボテン', category: 'plant', price: 80, maxQty: null,
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="24" y="20" width="16" height="38" rx="8" fill="#7DB87A"/>
      <rect x="10" y="28" width="18" height="10" rx="5" fill="#7DB87A"/>
      <rect x="36" y="22" width="18" height="10" rx="5" fill="#7DB87A"/>
      <rect x="10" y="24" width="6" height="14" rx="3" fill="#7DB87A"/>
      <rect x="48" y="18" width="6" height="14" rx="3" fill="#7DB87A"/>
      <rect x="22" y="56" width="20" height="6" rx="2" fill="#C4956A"/>
    </svg>`,
  },
  {
    id: 'plant_flowerbed', name: 'お花畑', category: 'plant', price: 80, maxQty: null,
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="32" cy="54" rx="28" ry="8" fill="#7DB87A"/>
      <circle cx="16" cy="42" r="7" fill="#F0A830"/>
      <circle cx="32" cy="38" r="8" fill="#E85454"/>
      <circle cx="48" cy="42" r="7" fill="#F0A830"/>
      <circle cx="24" cy="46" r="6" fill="#5490E8"/>
      <circle cx="40" cy="46" r="6" fill="#F4A0B0"/>
      <circle cx="16" cy="42" r="3" fill="#FFF"/>
      <circle cx="32" cy="38" r="3" fill="#FFF"/>
      <circle cx="48" cy="42" r="3" fill="#FFF"/>
    </svg>`,
  },
  {
    id: 'plant_mushroom', name: 'きのこ', category: 'plant', price: 80, maxQty: null,
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="26" y="36" width="12" height="22" rx="4" fill="#F7F3E8"/>
      <ellipse cx="32" cy="36" rx="22" ry="14" fill="#E85454"/>
      <circle cx="22" cy="32" r="4" fill="#FFF" opacity="0.7"/>
      <circle cx="36" cy="26" r="5" fill="#FFF" opacity="0.7"/>
      <circle cx="46" cy="34" r="3" fill="#FFF" opacity="0.7"/>
    </svg>`,
  },
  {
    id: 'plant_bigtree', name: '大きな木', category: 'plant', price: 80, maxQty: null,
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="27" y="38" width="10" height="24" rx="3" fill="#8B5E3C"/>
      <circle cx="32" cy="28" r="20" fill="#5A9457"/>
      <circle cx="20" cy="34" r="14" fill="#7DB87A"/>
      <circle cx="44" cy="34" r="14" fill="#7DB87A"/>
      <circle cx="32" cy="16" r="12" fill="#7DB87A"/>
    </svg>`,
  },
  // 小物（複数購入可）
  {
    id: 'item_bench', name: 'ベンチ', category: 'item', price: 50, maxQty: null,
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="28" width="48" height="6" rx="3" fill="#C4956A"/>
      <rect x="10" y="34" width="6" height="18" rx="2" fill="#8B5E3C"/>
      <rect x="48" y="34" width="6" height="18" rx="2" fill="#8B5E3C"/>
      <rect x="10" y="20" width="6" height="14" rx="2" fill="#C4956A"/>
      <rect x="48" y="20" width="6" height="14" rx="2" fill="#C4956A"/>
    </svg>`,
  },
  {
    id: 'item_lantern', name: '石灯籠', category: 'item', price: 50, maxQty: null,
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="20" y="8" width="24" height="4" rx="2" fill="#9A8870"/>
      <rect x="22" y="12" width="20" height="22" rx="3" fill="#F7F3E8"/>
      <rect x="24" y="14" width="16" height="18" rx="2" fill="#F0A830" opacity="0.6"/>
      <rect x="26" y="34" width="12" height="6" rx="1" fill="#9A8870"/>
      <rect x="28" y="40" width="8" height="18" rx="2" fill="#9A8870"/>
      <rect x="22" y="56" width="20" height="4" rx="2" fill="#9A8870"/>
    </svg>`,
  },
  {
    id: 'item_treasure', name: '宝箱', category: 'item', price: 50, maxQty: null,
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="8" y="32" width="48" height="28" rx="4" fill="#C4956A"/>
      <path d="M8,32 Q8,18 32,18 Q56,18 56,32 Z" fill="#8B5E3C"/>
      <rect x="6" y="30" width="52" height="6" rx="2" fill="#F0A830"/>
      <rect x="26" y="36" width="12" height="10" rx="2" fill="#F0A830"/>
      <circle cx="32" cy="41" r="3" fill="#C4956A"/>
    </svg>`,
  },
  {
    id: 'item_signboard', name: '看板', category: 'item', price: 50, maxQty: null,
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect x="29" y="32" width="6" height="28" rx="2" fill="#8B5E3C"/>
      <rect x="10" y="10" width="44" height="26" rx="4" fill="#F0A830"/>
      <rect x="14" y="14" width="36" height="18" rx="2" fill="#FFF" opacity="0.4"/>
      <rect x="16" y="19" width="24" height="3" rx="1" fill="#8B5E3C"/>
      <rect x="16" y="25" width="18" height="3" rx="1" fill="#8B5E3C"/>
    </svg>`,
  },
  {
    id: 'item_pond', name: '池', category: 'item', price: 50, maxQty: null,
    svg: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="32" cy="44" rx="26" ry="14" fill="#5490E8" opacity="0.3"/>
      <ellipse cx="32" cy="42" rx="24" ry="12" fill="#5490E8"/>
      <ellipse cx="26" cy="38" rx="8" ry="4" fill="#7EB8F8" opacity="0.5"/>
      <circle cx="20" cy="44" r="3" fill="#7DB87A"/>
      <circle cx="44" cy="40" r="4" fill="#7DB87A"/>
      <circle cx="38" cy="48" r="2" fill="#7DB87A"/>
    </svg>`,
  },
];

/** カテゴリ表示名 */
const ITEM_CATEGORIES = [
  { id: 'building', label: '建物' },
  { id: 'plant',    label: '植物' },
  { id: 'item',     label: '小物' },
];

/** 進化閾値（総合力 = HP+MP+ATK+DEF） */
const EVOLUTION_THRESHOLDS = [
  { stage: 1, power: 100 },
  { stage: 2, power: 300 },
];

/**
 * 1ステータスの上昇量を計算（確率減衰・性格補正適用）
 * @param {number} current - 現在値
 * @param {boolean} bonusStat - 性格ボーナス対象か
 * @param {number} bonusMult - ボーナス倍率
 * @param {number} [rarityGrowthProb] - レア度別ボーナス確率（省略時はコモン相当）
 * @returns {number} 上昇量（0以上）
 */
function calcStatGain(current, bonusStat, bonusMult, rarityGrowthProb = RARE_GROWTH_PROB, cap = STAT_CAP) {
  const ratio = current / cap;
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

  // 満腹度回復
  fresh.hunger = Math.min(100, fresh.hunger + FEED_HUNGER_RESTORE);

  // ステータス上限（個性反映：statCapsがあれば使用、なければSTAT_CAP）
  const caps = fresh.statCaps ?? { hp: STAT_CAP, mp: STAT_CAP, attack: STAT_CAP, defense: STAT_CAP };

  // 全ステータスが上限か判定（攻撃・防御のみ対象）
  const allCapped = fresh.attack >= caps.attack && fresh.defense >= caps.defense;

  if (!allCapped) {
    const bonus      = PERSONALITY_BONUS[fresh.personalityIndex] ?? PERSONALITY_BONUS[4];
    const growthProb = RARITY_GROWTH_PROB[fresh.rarity] ?? RARE_GROWTH_PROB;

    const applyGain = (stat) => {
      if (fresh[stat] >= caps[stat]) return;
      const isBonusStat = bonus.stat === stat || bonus.stat === 'all';
      const gain = calcStatGain(fresh[stat], isBonusStat, bonus.mult, growthProb, caps[stat]);
      fresh[stat] = Math.min(caps[stat], fresh[stat] + gain);
    };

    applyGain('attack');
    applyGain('defense');
  }

  await savePet(fresh);

  // 進化チェック（既存データにevolutionStageがない場合は0扱い）
  const currentStage = fresh.evolutionStage ?? 0;
  const power = fresh.hp + fresh.mp + fresh.attack + fresh.defense;
  const nextEvolution = EVOLUTION_THRESHOLDS.find(t => t.stage === currentStage + 1 && power >= t.power);
  if (nextEvolution) {
    fresh.evolutionStage = nextEvolution.stage;
    await savePet(fresh);
    return { ok: true, evolved: true, evolutionStage: fresh.evolutionStage };
  }

  return { ok: true, evolved: false };
}

/**
 * 水やり処理（HP+10・無料）
 * @param {Pet} pet
 * @returns {Promise<void>}
 */
async function waterPet(pet) {
  const fresh = await getPet(pet.id);
  if (!fresh) return;
  const hpCap = fresh.statCaps?.hp ?? 100;
  const mpCap = fresh.statCaps?.mp ?? 100;
  fresh.hp = Math.min(hpCap, fresh.hp + 10);
  fresh.mp = Math.min(mpCap, fresh.mp + 10);
  await savePet(fresh);
}

// ===== T3：ショップ =====

/** ショップの現在タブ */
let shopCurrentTab = 'building';

async function renderShop() {
  const container = document.getElementById('shop-items');
  container.innerHTML = '';

  const user = await getUser();
  const totalOwned = (user.ownedItems ?? []).reduce((s, o) => s + o.qty, 0);

  // タブバー
  const tabBar = document.createElement('div');
  tabBar.className = 'shop-tab-bar';
  ITEM_CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `shop-tab${shopCurrentTab === cat.id ? ' active' : ''}`;
    btn.textContent = cat.label;
    btn.addEventListener('click', () => {
      shopCurrentTab = cat.id;
      renderShop();
    });
    tabBar.appendChild(btn);
  });
  container.appendChild(tabBar);

  // グリッド
  const grid = document.createElement('div');
  grid.className = 'shop-item-grid';

  const items = ITEM_CATALOG.filter(it => it.category === shopCurrentTab);
  items.forEach(item => {
    const owned = (user.ownedItems ?? []).find(o => o.itemId === item.id);
    const ownedQty = owned?.qty ?? 0;

    // 購入可否判定
    const isBuildingCapped = item.maxQty === 1 && ownedQty >= 1;
    const isTotalCapped    = totalOwned >= HOUSING_TOTAL_CAP;
    const canBuy = !isBuildingCapped && !isTotalCapped && user.currency >= item.price;

    const bgColor = item.category === 'building' ? '#f0ece4'
                  : item.category === 'plant'    ? '#edf7ec'
                  : '#fdf4e0';

    const card = document.createElement('div');
    card.className = 'shop-item-card';

    const svgWrap = document.createElement('div');
    svgWrap.className = 'shop-item-svg-wrap';
    svgWrap.style.background = bgColor;
    svgWrap.innerHTML = item.svg;
    svgWrap.querySelector('svg').style.cssText = 'width:48px;height:48px';

    const name = document.createElement('div');
    name.className = 'shop-item-name';
    name.textContent = item.name;

    const footer = document.createElement('div');
    footer.className = 'shop-item-footer';

    const price = document.createElement('span');
    price.className = 'shop-item-price';
    price.textContent = `🪙${item.price}`;

    const btn = document.createElement('button');
    btn.className = 'btn-buy';
    btn.textContent = isBuildingCapped ? '所持済' : isTotalCapped ? '上限' : '購入';
    btn.disabled = !canBuy;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const { ok } = await spendCurrency(item.price);
      if (!ok) { alert(`通貨が足りません（必要: 🪙${item.price}）`); btn.disabled = false; return; }
      const u = await getUser();
      if (!u.ownedItems) u.ownedItems = [];
      const entry = u.ownedItems.find(o => o.itemId === item.id);
      if (entry) { entry.qty += 1; } else { u.ownedItems.push({ itemId: item.id, qty: 1 }); }
      await saveUser(u);
      await renderStatusBar();
      await renderShop();
    });

    footer.append(price, btn);
    card.append(svgWrap, name, footer);
    grid.appendChild(card);
  });

  container.appendChild(grid);
}

// ===== T4：訓練画面 =====

/** 訓練画面の状態（選択中難易度・選択中ペット・ログ・敵属性） */
let battleState = { difficultyId: 'normal', petId: null, log: [], enemyAttribute: null, aborted: false, session: null };

/** 敵種類ランダム抽選（モーダル演出用・バトル計算に影響しない） */
function pickEnemyType() {
  return PET_TYPES[Math.floor(Math.random() * PET_TYPES.length)].label;
}

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
          const warn = p.hp <= 0 ? '⚠️HP0' : p.hunger <= 0 ? '⚠️満腹度低' : '';
          return `
          <div class="cage-card${p.id === battleState.petId ? ' in-garden' : ''}"
               style="min-width:80px;padding:8px"
               data-pet-id="${p.id}">
            <img src="" alt="${p.type}" style="width:56px;height:56px;border-radius:10px;object-fit:cover" data-blob-pet="${p.id}">
            <div class="cage-card-name" style="font-size:11px">${p.name ?? p.type}</div>
            <div style="font-size:9px;color:var(--color-text-light);text-align:center">${p.type}</div>
            ${warn ? `<div style="font-size:9px;color:var(--color-hp);font-weight:700;text-align:center;margin-top:2px">${warn}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
  `;

  // 選択ペットのステータス表示
  const canBlock = selectedPet.hp <= 0 ? 'HP0のため訓練不可（餌で回復）'
                 : selectedPet.hunger <= 0 ? '満腹度0のため訓練不可（餌で回復）'
                 : null;

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
      <button id="battle-start-btn" class="btn-primary" style="width:100%;margin-top:10px"${canBlock ? ' disabled' : ''}>
        ⚔️ 訓練開始
      </button>
    </div>
  `;

  const price = 10 * user.level;
  const statusHTML = `
    <div style="background:var(--color-white);border-radius:var(--radius-card);padding:14px;margin-bottom:14px;box-shadow:var(--shadow)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <canvas id="battle-pet-canvas" width="56" height="56" style="border-radius:10px;flex-shrink:0"></canvas>
        <div>
          <div style="font-weight:700;font-size:15px">${selectedPet.name ?? selectedPet.type}</div>
          <div style="font-size:11px;color:var(--color-text-light)">${selectedPet.type} / ${selectedPet.personality} / ${selectedPet.attribute} / ${selectedPet.rarity}</div>
          <div style="font-size:11px;color:var(--color-mp);margin-top:2px">✨ スキル: ${SKILLS.find(s => s.id === selectedPet.skill)?.label ?? selectedPet.skill ?? '—'}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-bottom:6px">
        ${statBar('HP',   selectedPet.hp,      'hp',  selectedPet.statCaps?.hp      ?? 100)}
        ${statBar('MP',   selectedPet.mp,      'mp',  selectedPet.statCaps?.mp      ?? 100)}
        ${statBar('攻撃', selectedPet.attack,  'atk', selectedPet.statCaps?.attack  ?? 100)}
        ${statBar('防御', selectedPet.defense, 'def', selectedPet.statCaps?.defense ?? 100)}
      </div>
      ${statBar('満腹度', selectedPet.hunger, 'hunger')}
      <div style="display:flex;gap:6px;margin-top:10px">
        <button id="battle-feed-btn" class="btn-buy" style="flex:1;font-size:12px;padding:7px 0">🍖 餌 🪙${price}</button>
        <button id="battle-water-btn" class="btn-buy" style="flex:1;font-size:12px;padding:7px 0;background:var(--color-mp)">💧 おみず</button>
      </div>
      ${canBlock ? `<p style="color:var(--color-hp);font-size:12px;margin-top:8px;text-align:center">${canBlock}</p>` : ''}
    </div>
  `;

  const hasLog = battleState.log.length > 0;
  area.innerHTML = petSelectHTML + diffHTML + statusHTML + `
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
  const battlePetEvoClass = getEvolutionClass(selectedPet.evolutionStage ?? 0);
  if (battlePetEvoClass) document.getElementById('battle-pet-canvas').classList.add(battlePetEvoClass);

  // ペット一覧のBlob画像を設定
  pets.forEach(p => {
    const imgEl = area.querySelector(`img[data-blob-pet="${p.id}"]`);
    if (!imgEl) return;
    const url = URL.createObjectURL(p.imageData);
    imgEl.src = url;
    imgEl.onload  = () => URL.revokeObjectURL(url);
    imgEl.onerror = () => URL.revokeObjectURL(url);
    const evoClass = getEvolutionClass(p.evolutionStage ?? 0);
    if (evoClass) imgEl.classList.add(evoClass);
  });

  // 訓練画面：給餌ボタン
  document.getElementById('battle-feed-btn').addEventListener('click', async () => {
    const btn = document.getElementById('battle-feed-btn');
    btn.disabled = true;
    const fresh = await getPet(battleState.petId);
    if (!fresh) { btn.disabled = false; return; }
    const result = await feedPet(fresh);
    if (!result.ok) { alert(result.message); btn.disabled = false; return; }
    const updated = await getPet(battleState.petId);
    const screen = document.getElementById('screen-battle');
    const screenScroll = screen ? screen.scrollTop : 0;
    await renderBattle();
    await renderStatusBar();
    await renderCage();
    await renderGarden();
    const screenAfter = document.getElementById('screen-battle');
    if (screenAfter) screenAfter.scrollTop = screenScroll;
    if (result.evolved && updated) showEvolutionOverlay(updated, result.evolutionStage);
  });

  // 訓練画面：水あげボタン
  document.getElementById('battle-water-btn').addEventListener('click', async () => {
    const btn = document.getElementById('battle-water-btn');
    btn.disabled = true;
    const fresh = await getPet(battleState.petId);
    if (!fresh) { btn.disabled = false; return; }
    await waterPet(fresh);
    const screen = document.getElementById('screen-battle');
    const screenScroll = screen ? screen.scrollTop : 0;
    await renderBattle();
    await renderStatusBar();
    await renderCage();
    await renderGarden();
    const screenAfter = document.getElementById('screen-battle');
    if (screenAfter) screenAfter.scrollTop = screenScroll;
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
  battleState.session = { battles: 0, wins: 0, totalExp: 0, totalCurrency: 0, battlesList: [] };

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
    const enemyTypeName = pickEnemyType();
    const enemyName = `${battleState.enemyAttribute}の${enemyTypeName.replace('系', '')}`;

    // 区切り行
    const sep = `── 第${battleCount}戦 ──`;
    appendLog(log, sep, 'var(--color-text-light)');
    appendLogDOM(modalLog, sep, 'var(--color-text-light)');

    const diff = DIFFICULTY_LEVELS.find(d => d.id === battleState.difficultyId) ?? DIFFICULTY_LEVELS[1];
    const enemyHpInitPct = Math.min(100, Math.round(diff.coeff * 66.7));
    const enemyMpInitPct = Math.min(100, Math.round(diff.coeff * 55.0));
    updateBattleLogModalEnemy(enemyName, battleState.enemyAttribute, enemyTypeName, diff.coeff);

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

    // バー減少演出
    const petForAnim = await getPet(battleState.petId);
    if (petForAnim) animateBattleBars(result, petForAnim, enemyHpInitPct, enemyMpInitPct);

    // session集計
    battleState.session.battles++;
    if (result.won) battleState.session.wins++;
    battleState.session.totalExp      += result.expGained;
    battleState.session.totalCurrency += result.currencyGained;
    battleState.session.battlesList.push({ no: battleCount, enemyName, won: result.won });

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
    document.body.appendChild(overlay);
  }

  // 選択中ペットデータを同期取得（キャッシュ不要・getPetは非同期だがここではbattleState.petIdのDOM描画のみ）
  overlay.innerHTML = `
    <div style="background:var(--color-white);border-radius:20px;width:min(320px,88vw);height:420px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.18)">
      <div style="padding:12px 16px 10px;border-bottom:1px solid rgba(154,136,112,0.2);flex-shrink:0">
        <p style="margin:0;font-size:14px;font-weight:700;text-align:center;color:var(--color-text)">訓練中</p>
      </div>
      <div id="battle-log-modal-vs" style="padding:12px 16px 10px;display:grid;grid-template-columns:1fr 24px 1fr;align-items:start;flex-shrink:0">
        <div style="display:flex;flex-direction:column;align-items:center;gap:5px">
          <canvas id="blm-pet-canvas" width="72" height="72" style="border-radius:10px;flex-shrink:0"></canvas>
          <p id="blm-pet-name" style="margin:0;font-size:12px;font-weight:700;color:var(--color-text);text-align:center"></p>
          <p id="blm-pet-sub" style="margin:0;font-size:10px;color:var(--color-text-light);text-align:center"></p>
          <div style="width:100%;display:flex;flex-direction:column;gap:4px;margin-top:2px">
            <div>
              <div style="font-size:10px;color:var(--color-text-light);margin-bottom:2px">HP</div>
              <div style="height:6px;background:rgba(154,136,112,0.15);border-radius:3px;overflow:hidden">
                <div id="blm-pet-hp-bar" style="height:100%;border-radius:3px;background:var(--color-hp);transition:width 0.5s ease"></div>
              </div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--color-text-light);margin-bottom:2px">MP</div>
              <div style="height:6px;background:rgba(154,136,112,0.15);border-radius:3px;overflow:hidden">
                <div id="blm-pet-mp-bar" style="height:100%;border-radius:3px;background:var(--color-mp);transition:width 0.5s ease"></div>
              </div>
            </div>
          </div>
        </div>
        <div style="display:flex;align-items:flex-start;justify-content:center;padding-top:28px">
          <span style="font-size:11px;color:var(--color-text-light)">VS</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:5px">
          <div style="width:72px;height:72px;border-radius:10px;background:rgba(154,136,112,0.12);display:flex;align-items:center;justify-content:center;font-size:32px;flex-shrink:0">👾</div>
          <p id="blm-enemy-name" style="margin:0;font-size:12px;font-weight:700;color:var(--color-text);text-align:center"></p>
          <p id="blm-enemy-sub" style="margin:0;font-size:10px;color:var(--color-text-light);text-align:center"></p>
          <div style="width:100%;display:flex;flex-direction:column;gap:4px;margin-top:2px">
            <div>
              <div style="font-size:10px;color:var(--color-text-light);margin-bottom:2px">HP</div>
              <div style="height:6px;background:rgba(154,136,112,0.15);border-radius:3px;overflow:hidden">
                <div id="blm-enemy-hp-bar" style="height:100%;border-radius:3px;background:var(--color-hp);transition:width 0.5s ease"></div>
              </div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--color-text-light);margin-bottom:2px">MP</div>
              <div style="height:6px;background:rgba(154,136,112,0.15);border-radius:3px;overflow:hidden">
                <div id="blm-enemy-mp-bar" style="height:100%;border-radius:3px;background:var(--color-mp);transition:width 0.5s ease"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="battle-log-modal-body" style="margin:0 16px;background:rgba(154,136,112,0.08);border-radius:10px;padding:10px 12px;flex:1;overflow-y:auto;font-size:12px;line-height:1.9;min-height:0"></div>
      <div style="padding:10px 16px 14px;flex-shrink:0">
        <button id="battle-abort-btn" style="width:100%;padding:10px 0;border-radius:12px;border:1px solid var(--color-hp);background:rgba(232,84,84,0.08);color:var(--color-hp);font-size:13px;font-weight:700;cursor:pointer">中断</button>
      </div>
    </div>
  `;

  // ペットデータを非同期で反映
  getPet(battleState.petId).then(pet => {
    if (!pet) return;
    const nameEl = document.getElementById('blm-pet-name');
    const subEl  = document.getElementById('blm-pet-sub');
    const hpBar  = document.getElementById('blm-pet-hp-bar');
    const mpBar  = document.getElementById('blm-pet-mp-bar');
    if (nameEl) nameEl.textContent = pet.name ?? pet.type;
    if (subEl)  subEl.textContent  = `${pet.type} / ${pet.attribute}`;
    const hpCap = pet.statCaps?.hp ?? 100;
    const mpCap = pet.statCaps?.mp ?? 100;
    if (hpBar) hpBar.style.width = `${Math.min(100, (pet.hp / hpCap) * 100)}%`;
    if (mpBar) mpBar.style.width = `${Math.min(100, (pet.mp / mpCap) * 100)}%`;
    const canvas = document.getElementById('blm-pet-canvas');
    if (canvas) drawPetToCanvas(pet, canvas, 72, 10);
  });

  document.getElementById('battle-abort-btn').onclick = () => {
    battleState.aborted = true;
  };
  const body = document.getElementById('battle-log-modal-body');
  body.innerHTML = '';
  overlay.classList.remove('hidden');
  return body;
}

/**
 * バトルログモーダルの敵情報を更新（各戦開始時に呼び出し）
 * @param {string} enemyName - 「火のドラゴン」形式
 * @param {string} enemyAttribute - 属性文字
 * @param {string} typeName - 種類ラベル（「ドラゴン系」など）
 * @param {number} diffCoeff - 難易度係数（敵HPバー割合算出用）
 */
function updateBattleLogModalEnemy(enemyName, enemyAttribute, typeName, diffCoeff) {
  const nameEl  = document.getElementById('blm-enemy-name');
  const subEl   = document.getElementById('blm-enemy-sub');
  const hpBar   = document.getElementById('blm-enemy-hp-bar');
  const mpBar   = document.getElementById('blm-enemy-mp-bar');
  if (nameEl) nameEl.textContent = enemyName;
  if (subEl)  subEl.textContent  = `${typeName} / ${enemyAttribute}`;
  // 難易度係数をバー割合に変換（easy=0.5→50%, normal=1.0→75%, hard=1.5→100%）
  const hpPct = Math.min(100, Math.round(diffCoeff * 66.7));
  const mpPct = Math.min(100, Math.round(diffCoeff * 55.0));
  if (hpBar) hpBar.style.width = `${hpPct}%`;
  if (mpBar) mpBar.style.width = `${mpPct}%`;
}

/**
 * バトル結果後にペット・敵のHP/MPバーを減少演出（演出専用）
 * @param {object} result - runBattle戻り値
 * @param {object} pet - 最新ペットデータ
 * @param {number} enemyHpInitPct - 敵HP初期割合（updateBattleLogModalEnemyで設定した値）
 * @param {number} enemyMpInitPct - 敵MP初期割合
 */
function animateBattleBars(result, pet, enemyHpInitPct, enemyMpInitPct) {
  // ペット実値バー更新
  const petHpCap = pet.statCaps?.hp ?? 100;
  const petMpCap = pet.statCaps?.mp ?? 100;
  const petHpPct = Math.min(100, Math.max(0, (result.petHpAfter / petHpCap) * 100));
  const petMpPct = Math.min(100, Math.max(0, (pet.mp / petMpCap) * 100));
  const petHpBar = document.getElementById('blm-pet-hp-bar');
  const petMpBar = document.getElementById('blm-pet-mp-bar');
  if (petHpBar) petHpBar.style.width = `${petHpPct}%`;
  if (petMpBar) petMpBar.style.width = `${petMpPct}%`;

  // 敵疑似バー：勝利→0%、敗北→初期値の35%残存
  const enemyHpAfter = result.won ? 0 : Math.round(enemyHpInitPct * 0.35);
  const enemyMpAfter = result.won ? 0 : Math.round(enemyMpInitPct * 0.35);
  const enemyHpBar = document.getElementById('blm-enemy-hp-bar');
  const enemyMpBar = document.getElementById('blm-enemy-mp-bar');
  if (enemyHpBar) enemyHpBar.style.width = `${enemyHpAfter}%`;
  if (enemyMpBar) enemyMpBar.style.width = `${enemyMpAfter}%`;
}
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
    document.body.appendChild(overlay);
  }

  const stopLabel = stopReason === 'aborted' ? '🛑 中断しました' : null;

  // 戦歴リスト行HTML
  const battlesListHTML = (session.battlesList ?? []).map(b => `
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(154,136,112,0.15)">
      <span style="font-size:11px;color:var(--color-text-light);min-width:26px">${b.no}戦</span>
      <span style="font-size:12px;color:var(--color-text-light);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${b.enemyName}</span>
      <span style="font-size:12px;font-weight:700;color:${b.won ? 'var(--color-main)' : 'var(--color-hp)'}">${b.won ? '勝利' : '敗北'}</span>
    </div>
  `).join('');

  overlay.innerHTML = `
    <div style="background:var(--color-white);border-radius:20px;width:min(320px,88vw);height:420px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.18)">
      <div style="padding:12px 16px 10px;border-bottom:1px solid rgba(154,136,112,0.2);flex-shrink:0">
        <p id="bro-title" style="margin:0;font-size:14px;font-weight:700;text-align:center"></p>
      </div>
      <div style="padding:10px 16px 8px;border-bottom:1px solid rgba(154,136,112,0.2);flex-shrink:0;display:flex;justify-content:center;gap:24px">
        <span style="font-size:13px;color:var(--color-text)">EXP <strong style="font-weight:700;color:var(--color-main)">+${session.totalExp}</strong></span>
        <span style="font-size:13px;color:var(--color-text)">🪙 <strong style="font-weight:700;color:var(--color-accent)">+${session.totalCurrency}</strong></span>
      </div>
      <div style="padding:6px 16px 4px;flex-shrink:0;max-height:130px;overflow-y:auto">
        ${battlesListHTML}
        ${stopLabel ? `<div style="padding:6px 0;font-size:11px;color:var(--color-text-light);text-align:center">${stopLabel}</div>` : ''}
      </div>
      <div id="bro-log" style="margin:0 16px;background:rgba(154,136,112,0.08);border-radius:10px;padding:10px 12px;flex:1;overflow-y:auto;font-size:12px;line-height:1.9;min-height:0"></div>
      <div style="padding:10px 16px 14px;flex-shrink:0">
        <button id="battle-result-ok-btn" style="width:100%;padding:10px 0;border-radius:12px;border:1px solid rgba(154,136,112,0.3);background:rgba(154,136,112,0.1);color:var(--color-text);font-size:13px;font-weight:700;cursor:pointer">OK</button>
      </div>
    </div>
  `;

  // タイトル
  const titleEl = document.getElementById('bro-title');
  titleEl.textContent = `${session.wins}勝 / ${session.battles}戦`;
  titleEl.style.color = session.wins > 0 ? 'var(--color-main)' : 'var(--color-hp)';

  // ログを転写
  const broLog = document.getElementById('bro-log');
  battleState.log.forEach(({ text, color }) => {
    const line = document.createElement('div');
    line.style.color = color;
    line.textContent = text;
    broLog.appendChild(line);
  });
  broLog.scrollTop = broLog.scrollHeight;

  overlay.classList.remove('hidden');
  document.getElementById('battle-result-ok-btn').onclick = () => {
    overlay.classList.add('hidden');
  };
  overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.add('hidden'); };
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

// ===== ハウジング：庭フッター・アイテムトレイ・配置モード =====

/** 現在の配置モード選択アイテムID */
let housingPlaceItemId = null;
/** 配置プレビュー要素 */
let housingPreviewEl = null;
/** トレイの現在タブ */
let trayCurrentTab = 'building';

/** アイテムトレイを閉じる・配置モードも解除 */
function closeItemTray() {
  const tray = document.getElementById('item-tray');
  if (tray) tray.classList.remove('open');
  exitPlaceMode();
}

/** 配置モード解除 */
function exitPlaceMode() {
  housingPlaceItemId = null;
  document.body.classList.remove('housing-place-mode');
  if (housingPreviewEl) { housingPreviewEl.remove(); housingPreviewEl = null; }
  const guide = document.getElementById('housing-guide-msg');
  if (guide) guide.hidden = true;
  window.removeEventListener('mousemove', onGardenPointerMove);
  window.removeEventListener('click',     onGardenClick);
  const gardenScreen = document.getElementById('screen-garden');
  gardenScreen.removeEventListener('pointerdown', onGardenPointerDown);
}

/** 庭フッター・トレイの初期化（起動時1回） */
function initGardenFooter() {
  // トレイDOMを生成してbodyに追加
  if (!document.getElementById('item-tray')) {
    const tray = document.createElement('div');
    tray.id = 'item-tray';
    tray.innerHTML = `
      <div class="item-tray-handle"></div>
      <div class="item-tray-header">
        <span style="font-size:13px;font-weight:700;color:var(--color-text)">アイテムを選択</span>
        <span id="item-tray-count" style="font-size:11px;color:var(--color-text-light)"></span>
      </div>
      <div class="item-tray-tabs" id="item-tray-tabs"></div>
      <div class="item-tray-list" id="item-tray-list"></div>
    `;
    document.body.appendChild(tray);
  }

  // タブ初期化
  const tabsEl = document.getElementById('item-tray-tabs');
  tabsEl.innerHTML = '';
  ITEM_CATEGORIES.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `item-tray-tab${trayCurrentTab === cat.id ? ' active' : ''}`;
    btn.textContent = cat.label;
    btn.dataset.catId = cat.id;
    btn.addEventListener('click', () => {
      trayCurrentTab = cat.id;
      document.querySelectorAll('.item-tray-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.catId === cat.id)
      );
      renderTrayItems();
    });
    tabsEl.appendChild(btn);
  });

  // デコボタン
  document.getElementById('garden-deco-btn').addEventListener('click', () => {
    const tray = document.getElementById('item-tray');
    if (tray.classList.contains('open')) {
      closeItemTray();
    } else {
      // ペットパネルを閉じる
      const panel = document.getElementById('pet-panel');
      panel.classList.remove('open');
      panel.classList.add('hidden');
      panelOpenPetId = null;
      renderTrayItems();
      tray.classList.add('open');
    }
  });
}

/** トレイのアイテム一覧を描画 */
async function renderTrayItems() {
  const list = document.getElementById('item-tray-list');
  const countEl = document.getElementById('item-tray-count');
  if (!list) return;
  list.innerHTML = '';

  const user = await getUser();
  const totalOwned = (user.ownedItems ?? []).reduce((s, o) => s + o.qty, 0);
  if (countEl) countEl.textContent = `合計 ${totalOwned} / ${HOUSING_TOTAL_CAP}`;

  const items = ITEM_CATALOG.filter(it => it.category === trayCurrentTab);
  items.forEach(item => {
    const owned = (user.ownedItems ?? []).find(o => o.itemId === item.id);
    const qty   = owned?.qty ?? 0;

    const card = document.createElement('div');
    card.className = `item-tray-card${qty === 0 ? ' unavailable' : ''}`;

    const iconBox = document.createElement('div');
    iconBox.className = `item-tray-icon${housingPlaceItemId === item.id ? ' selected' : ''}`;
    iconBox.innerHTML = item.svg;
    iconBox.querySelector('svg').style.cssText = 'width:36px;height:36px;display:block';

    if (qty > 1) {
      const badge = document.createElement('span');
      badge.className = 'item-qty-badge';
      badge.textContent = `×${qty}`;
      iconBox.appendChild(badge);
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'item-tray-name';
    nameEl.textContent = item.name;

    card.append(iconBox, nameEl);

    if (qty > 0) {
      card.addEventListener('click', () => {
        closeItemTray();
        enterPlaceMode(item);
      });
    }

    list.appendChild(card);
  });
}

/** 配置モード開始 */
function enterPlaceMode(item) {
  housingPlaceItemId = item.id;  // closeItemTray→exitPlaeModeでnullされるため再設定
  document.body.classList.add('housing-place-mode');

  // プレビュー要素をbody直下・position:fixedで生成（座標変換不要）
  const baseSize = ITEM_BASE_SIZE[item.category] ?? 48;
  housingPreviewEl = document.createElement('div');
  housingPreviewEl.className = 'garden-item-preview';
  housingPreviewEl.style.position = 'fixed';
  housingPreviewEl.innerHTML = item.svg;
  housingPreviewEl.querySelector('svg').style.cssText = `width:${baseSize}px;height:${baseSize}px;display:block`;
  document.body.appendChild(housingPreviewEl);

  // 初期位置：画面中央
  housingPreviewEl.style.left = `${window.innerWidth  / 2}px`;
  housingPreviewEl.style.top  = `${window.innerHeight / 2}px`;

  // ガイドメッセージ
  let guide = document.getElementById('housing-guide-msg');
  if (!guide) {
    guide = document.createElement('div');
    guide.id = 'housing-guide-msg';
    guide.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.55);color:#fff;font-size:12px;font-weight:700;padding:6px 16px;border-radius:999px;pointer-events:none;z-index:9999;white-space:nowrap';
    document.body.appendChild(guide);
  }
  guide.textContent = 'クリックで配置・庭の外でキャンセル';
  guide.hidden = false;

  window.addEventListener('mousemove', onGardenPointerMove);
  window.addEventListener('click',     onGardenClick);
  // タッチ用
  const gardenScreen = document.getElementById('screen-garden');
  gardenScreen.addEventListener('pointerdown', onGardenPointerDown);
}

/** ポインタ座標を庭エリアの % に変換するユーティリティ */
function _gardenPct(e, gardenEl) {
  const rect = gardenEl.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width)  * 100,
    y: ((e.clientY - rect.top)  / rect.height) * 100,
  };
}

/** プレビューをマウス位置に追従（position:fixed なので clientX/Y 直接使用） */
function onGardenPointerMove(e) {
  if (!housingPreviewEl || !housingPlaceItemId) return;
  housingPreviewEl.style.left = `${e.clientX}px`;
  housingPreviewEl.style.top  = `${e.clientY}px`;
}

/** PC用：マウスクリックで配置確定（window登録） */
function onGardenClick(e) {
  if (!housingPlaceItemId) return;
  if (e.target.closest('#item-tray') || e.target.closest('#garden-footer')) return;
  if (e.target.closest('#bottom-nav') || e.target.closest('.overlay:not(.hidden)')) return;
  _confirmPlace(e);
}

/** pointerdown: スマホ（touch）のみ配置確定 */
function onGardenPointerDown(e) {
  if (e.pointerType !== 'touch') return;
  _confirmPlace(e);
}

/** pointerup: 現在未使用（touch は pointerdown で確定済み）。将来拡張用に残す */
function onGardenPointerUp(e) {
  // no-op
}

/** 配置確定処理（タップ・クリック共通） */
async function _confirmPlace(e) {
  if (!housingPlaceItemId) return;
  const itemId = housingPlaceItemId;
  const item   = ITEM_CATALOG.find(it => it.id === itemId);
  if (!item) { exitPlaceMode(); return; }

  const gardenEl = document.getElementById('screen-garden');
  const rect = gardenEl.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;

  // 庭エリア外・草原エリア外（空エリア）でキャンセル
  if (px < 0 || px > rect.width || py < 0 || py > rect.height) {
    exitPlaceMode();
    return;
  }

  // DB保存用に%変換
  const xPct = Math.round((px / rect.width)  * 1000) / 10;
  const yPct = Math.round((py / rect.height) * 1000) / 10;

  // 草原エリア上端より上は配置不可
  if (yPct < GARDEN_Y_MIN) { exitPlaceMode(); return; }

  // 線形補間でsizeScale算出（GARDEN_Y_MIN=遠×0.5 〜 100=近×1.5）
  const sizeScale = DEPTH_SCALE_MIN + (yPct - GARDEN_Y_MIN) / (100 - GARDEN_Y_MIN) * (DEPTH_SCALE_MAX - DEPTH_SCALE_MIN);

  const u = await getUser();
  if (!u.placedItems) u.placedItems = [];
  if (!u.ownedItems)  u.ownedItems  = [];

  const own = u.ownedItems.find(o => o.itemId === itemId);
  if (!own || own.qty <= 0) { exitPlaceMode(); return; }

  own.qty -= 1;
  if (own.qty <= 0) u.ownedItems = u.ownedItems.filter(o => o.itemId !== itemId);
  const uid = `${Date.now()}_${Math.random()}`;
  u.placedItems.push({ uid, itemId, x: xPct, y: yPct, sizeScale });
  await saveUser(u);

  const guide = document.getElementById('housing-guide-msg');
  if (guide) guide.hidden = true;

  exitPlaceMode();
  await renderGarden();
}

// ===== 庭スロット拡張 =====

/**
 * 起動時整合チェック：現在Lvに対応する正しい gardenSlots を保証する
 * 既存データが拡張条件Lvに達しているがスロットが少ない場合に補正する
 */
async function syncRarity() {
  const RARITY_MIGRATION = {
    '★★★ レア':    '英雄',
    '★★ アンコモン': '希少',
    '★ コモン':     '高級',
  };
  // pet.typeがid（英語）だった場合にlabel（日本語）へ変換
  const TYPE_ID_TO_LABEL = Object.fromEntries(PET_TYPES.map(t => [t.id, t.label]));

  const pets = await getAllPets();
  for (const pet of pets) {
    let dirty = false;
    if (RARITY_MIGRATION[pet.rarity]) {
      pet.rarity = RARITY_MIGRATION[pet.rarity];
      dirty = true;
    }
    if (TYPE_ID_TO_LABEL[pet.type]) {
      pet.type = TYPE_ID_TO_LABEL[pet.type];
      dirty = true;
    }
    if (dirty) await savePet(pet);
  }
}

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

// ===== ペット削除確認ダイアログ =====

/**
 * 野に放つ（削除）確認ダイアログを表示
 * @param {Pet} pet
 */
function showReleaseConfirmDialog(pet) {
  let overlay = document.getElementById('overlay-release-confirm');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'overlay-release-confirm';
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="overlay-card">
        <h3 style="color:var(--color-hp)">🌿 野に放つ</h3>
        <canvas id="release-confirm-canvas" width="80" height="80" style="border-radius:14px;margin:4px 0"></canvas>
        <p id="release-confirm-name" style="font-size:15px;font-weight:700"></p>
        <p style="font-size:12px;color:var(--color-text-light);text-align:center">この操作は取り消せません。<br>本当に野に放ちますか？</p>
        <div style="display:flex;gap:8px;width:100%;margin-top:4px">
          <button class="btn-primary" id="release-confirm-ok" style="flex:1;background:var(--color-hp)">放つ</button>
          <button class="btn-primary" id="release-confirm-cancel" style="flex:1;background:#aaa">キャンセル</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  document.getElementById('release-confirm-name').textContent = pet.name ?? pet.type;
  drawPetToCanvas(pet, document.getElementById('release-confirm-canvas'), 80, 14);
  overlay.classList.remove('hidden');

  document.getElementById('release-confirm-cancel').onclick = () => overlay.classList.add('hidden');

  document.getElementById('release-confirm-ok').onclick = async () => {
    overlay.classList.add('hidden');
    await deletePet(pet.id);
    cageEditMode = false;
    await renderCage();
    await renderGarden();
  };
}

// ===== ケージフッター キャンセル・繁殖実行ボタン初期化 =====

function initCageFooterCancelButtons() {
  document.getElementById('generate-footer-cancel').onclick = () => {
    switchScreen('cage');
    document.querySelectorAll('.nav-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.screen === 'cage')
    );
  };
  document.getElementById('breed-footer-cancel').onclick = () => {
    switchScreen('cage');
    document.querySelectorAll('.nav-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.screen === 'cage')
    );
  };
}

// ===== 繁殖専用画面 =====

let breedSelectedIds = [];

async function renderBreedScreen() {
  breedSelectedIds = [];
  await _renderBreedArea();
}

async function _renderBreedArea() {
  const area = document.getElementById('breed-area');
  if (!area) return;
  const pets = (await getAllPets()).filter(p => (p.evolutionStage ?? 0) >= BREED_EVOLUTION_MIN);
  const user = await getUser();
  const cost = BREED_COST_MULTIPLIER * user.level;

  area.innerHTML = `
    <p style="font-size:12px;color:var(--color-text-light);padding:0 16px;margin-bottom:10px">
      2体選択・満腹度${BREED_HUNGER_MIN}以上・進化${BREED_EVOLUTION_MIN}段階以上が必要 / 🪙${cost}
    </p>
    <div id="breed-pet-list" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:0 16px"></div>
  `;

  const list = document.getElementById('breed-pet-list');
  if (pets.length === 0) {
    list.style.display = 'block';
    list.innerHTML = `<p style="font-size:13px;color:var(--color-text-light);text-align:center;padding:24px 0">進化2段階以上のペットがいません</p>`;
    _updateBreedExecBtn();
    return;
  }
  pets.forEach(pet => {
    const isSelected = breedSelectedIds.includes(pet.id);
    const canSelect  = pet.hunger >= BREED_HUNGER_MIN;

    const card = document.createElement('div');
    card.className = `cage-card${isSelected ? ' in-garden' : ''}`;
    if (!canSelect) card.style.opacity = '0.4';

    const canvas = document.createElement('canvas');
    canvas.width = 72; canvas.height = 72;
    canvas.style.cssText = 'border-radius:12px;object-fit:cover';
    drawPetToCanvas(pet, canvas, 72, 10);
    const evoClass = getEvolutionClass(pet.evolutionStage ?? 0);
    if (evoClass) canvas.classList.add(evoClass);

    const name = document.createElement('div');
    name.className = 'cage-card-name';
    name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;text-align:center';
    name.textContent = pet.name ?? pet.type;

    const sub = document.createElement('div');
    sub.style.cssText = 'font-size:10px;color:var(--color-text-light);text-align:center';
    sub.textContent = `${pet.type} / 満腹${pet.hunger}`;

    const check = document.createElement('div');
    check.style.cssText = `position:absolute;top:6px;right:6px;width:20px;height:20px;border-radius:50%;border:2px solid ${isSelected ? 'var(--color-main)' : '#CCC'};background:${isSelected ? 'var(--color-main)' : 'transparent'};display:flex;align-items:center;justify-content:center`;
    check.textContent = isSelected ? '✓' : '';
    check.style.color = 'white';
    check.style.fontSize = '11px';

    // チェックボックス：選択トグル
    if (canSelect) {
      check.style.cursor = 'pointer';
      check.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (isSelected) {
          breedSelectedIds = breedSelectedIds.filter(id => id !== pet.id);
        } else if (breedSelectedIds.length < 2) {
          breedSelectedIds.push(pet.id);
        }
        await _renderBreedArea();
        _updateBreedExecBtn();
      });
    }

    // カード本体：ステータスパネル表示（庭・ケージと同仕様）
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => showPetPanel(pet));

    if (!canSelect) {
      const hungerLabel = document.createElement('div');
      hungerLabel.style.cssText = 'font-size:10px;color:var(--color-hp);font-weight:700;text-align:center;background:rgba(232,84,84,0.12);border-radius:4px;padding:2px 4px;margin-top:2px';
      hungerLabel.textContent = '満腹度不足';
      card.append(wrapWithGenerationBadge(canvas, pet.generation ?? 0), name, sub, hungerLabel, check);
    } else {
      card.append(wrapWithGenerationBadge(canvas, pet.generation ?? 0), name, sub, check);
    }
    list.appendChild(card);
  });

  _updateBreedExecBtn();
}

function _updateBreedExecBtn() {
  const btn = document.getElementById('breed-footer-exec');
  if (!btn) return;
  btn.disabled = breedSelectedIds.length !== 2;
  btn.onclick = breedSelectedIds.length === 2 ? _execBreed : null;
}

async function _execBreed() {
  const btn = document.getElementById('breed-footer-exec');
  if (btn) { btn.disabled = true; }

  const allPets = await getAllPets();
  if (allPets.length >= BREED_PET_CAP) {
    alert(`ペットの所持上限（${BREED_PET_CAP}体）に達しています`);
    if (btn) btn.disabled = false;
    return;
  }

  const user = await getUser();
  const cost = BREED_COST_MULTIPLIER * user.level;
  const { ok } = await spendCurrency(cost);
  if (!ok) {
    const area = document.getElementById('breed-area');
    if (area) {
      let errMsg = document.getElementById('breed-cost-error');
      if (!errMsg) {
        errMsg = document.createElement('p');
        errMsg.id = 'breed-cost-error';
        errMsg.style.cssText = 'color:var(--color-hp);font-size:12px;text-align:center;background:rgba(232,84,84,0.1);border-radius:8px;padding:8px 12px;margin:0 16px';
        area.insertBefore(errMsg, area.firstChild);
      }
      errMsg.textContent = `🪙 通貨が足りません（必要: ${cost} / 所持: ${user.currency}）`;
      errMsg.hidden = false;
    }
    if (btn) btn.disabled = false;
    return;
  }
  // エラーメッセージがあれば隠す
  const existErr = document.getElementById('breed-cost-error');
  if (existErr) existErr.hidden = true;

  const [pA, pB] = await Promise.all([getPet(breedSelectedIds[0]), getPet(breedSelectedIds[1])]);
  if (!pA || !pB) { if (btn) btn.disabled = false; return; }

  const inheritedBlob = Math.random() < 0.5 ? pA.imageData : pB.imageData;
  const child = breedPet(pA, pB, inheritedBlob);
  await registerNewPet(child);

  breedSelectedIds = [];
  switchScreen('cage');
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.screen === 'cage')
  );
  await renderStatusBar();
  await renderEncyclopedia();
  await renderCage();
  showBreedResultOverlay(child);
}

// ===== 繁殖オーバーレイ =====

/**
 * 繁殖UI：2体選択→確認→実行
 * @param {Pet[]} pets
 * @param {User} user
 */
async function showBreedOverlay(pets, user) {
  let overlay = document.getElementById('overlay-breed');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'overlay-breed';
    overlay.className = 'overlay';
    document.body.appendChild(overlay);
  }

  // 選択状態管理
  let selectedIds = [];

  const render = async () => {
    // 毎回最新データを取得（給餌等による変化を反映）
    const latestPets = await getAllPets();
    const latestUser = await getUser();
    const cost = BREED_COST_MULTIPLIER * latestUser.level;
    overlay.innerHTML = `
      <div class="overlay-card" style="width:min(340px,92vw);max-height:80vh;overflow-y:auto">
        <h3 style="font-size:16px">💞 繁殖</h3>
        <p style="font-size:12px;color:var(--color-text-light);margin-top:-6px">
          2体選択・満腹度${BREED_HUNGER_MIN}以上が必要 / 🪙${cost}
        </p>
        <div id="breed-pet-list" style="display:flex;flex-direction:column;gap:8px;width:100%;margin:10px 0"></div>
        <div style="display:flex;gap:8px;width:100%;margin-top:4px">
          <button class="btn-primary" id="breed-exec-btn"
            style="flex:1;background:var(--color-accent)"
            ${selectedIds.length !== 2 ? 'disabled' : ''}>
            繁殖！
          </button>
          <button class="btn-primary" id="breed-cancel-btn" style="flex:1;background:#aaa">キャンセル</button>
        </div>
      </div>
    `;

    const list = document.getElementById('breed-pet-list');
    latestPets.forEach(pet => {
      const isSelected = selectedIds.includes(pet.id);
      const canSelect  = pet.hunger >= BREED_HUNGER_MIN;
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:10px;background:${isSelected ? 'rgba(125,184,122,0.15)' : 'var(--color-bg)'};border-radius:10px;padding:8px 12px;cursor:${canSelect ? 'pointer' : 'default'};border:2px solid ${isSelected ? 'var(--color-main)' : 'transparent'};opacity:${canSelect ? '1' : '0.45'}`;

      const canvas = document.createElement('canvas');
      canvas.width = 40; canvas.height = 40;
      canvas.style.cssText = 'border-radius:8px;flex-shrink:0';
      drawPetToCanvas(pet, canvas, 40, 6);

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';
      info.innerHTML = `
        <div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${pet.name ?? pet.type}</div>
        <div style="font-size:10px;color:var(--color-text-light)">${pet.type} / 満腹${pet.hunger}</div>
      `;

      if (canSelect) {
        row.addEventListener('click', async () => {
          if (isSelected) {
            selectedIds = selectedIds.filter(id => id !== pet.id);
          } else if (selectedIds.length < 2) {
            selectedIds.push(pet.id);
          }
          await render();
        });
      }
      row.append(canvas, info);
      list.appendChild(row);
    });

    document.getElementById('breed-cancel-btn').onclick = () => overlay.classList.add('hidden');

    document.getElementById('breed-exec-btn').onclick = async () => {
      if (selectedIds.length !== 2) return;
      const btn = document.getElementById('breed-exec-btn');
      btn.disabled = true;
      btn.textContent = '合成中...';

      // 所持上限チェック
      const allPets = await getAllPets();
      if (allPets.length >= BREED_PET_CAP) {
        alert(`ペットの所持上限（${BREED_PET_CAP}体）に達しています`);
        btn.disabled = false; btn.textContent = '繁殖！'; return;
      }

      // 通貨消費（最新userで計算）
      const currentUser = await getUser();
      const currentCost = BREED_COST_MULTIPLIER * currentUser.level;
      const { ok } = await spendCurrency(currentCost);
      if (!ok) {
        alert(`通貨が足りません（必要: 🪙${currentCost}）`);
        btn.disabled = false; btn.textContent = '繁殖！'; return;
      }

      // 親データ取得
      const [pA, pB] = await Promise.all([getPet(selectedIds[0]), getPet(selectedIds[1])]);
      if (!pA || !pB) { btn.disabled = false; btn.textContent = '繁殖！'; return; }

      // 親どちらかの画像を50/50で継承→子生成→保存
      const inheritedBlob = Math.random() < 0.5 ? pA.imageData : pB.imageData;
      const child          = breedPet(pA, pB, inheritedBlob);
      await registerNewPet(child);

      overlay.classList.add('hidden');
      await renderStatusBar();
      await renderEncyclopedia();
      await renderCage();
      showBreedResultOverlay(child);
    };
  };

  await render();
  overlay.classList.remove('hidden');
}

/** 繁殖完了オーバーレイ */
function showBreedResultOverlay(child) {
  let overlay = document.getElementById('overlay-breed-result');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'overlay-breed-result';
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="overlay-card">
        <h3>💞 新しいペットが生まれた！</h3>
        <canvas id="breed-result-canvas" width="100" height="100" style="border-radius:18px;margin:4px 0"></canvas>
        <div id="breed-result-body" style="font-size:13px;text-align:left;width:100%;line-height:2"></div>
        <button class="btn-primary" id="breed-result-ok-btn">ケージへ</button>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  drawPetToCanvas(child, document.getElementById('breed-result-canvas'), 100, 18);
  document.getElementById('breed-result-body').innerHTML = `
    <div>名前: <strong>${child.name}</strong></div>
    <div>種族: <strong>${child.type}</strong></div>
    <div>性格: <strong>${child.personality}</strong></div>
    <div>属性: <strong>${child.attribute}</strong></div>
    <div>レア度: <strong>${child.rarity}</strong></div>
    <div style="font-size:11px;color:var(--color-text-light)">HP ${child.hp} / MP ${child.mp} / ATK ${child.attack} / DEF ${child.defense}</div>
  `;
  overlay.classList.remove('hidden');
  const closeBreedResult = () => {
    overlay.classList.add('hidden');
    switchScreen('cage');
    document.querySelectorAll('.nav-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.screen === 'cage')
    );
  };
  document.getElementById('breed-result-ok-btn').onclick = closeBreedResult;
  overlay.onclick = (e) => { if (e.target === overlay) closeBreedResult(); };
}

// ===== 進化演出オーバーレイ =====

/**
 * 進化演出オーバーレイを表示
 * @param {Pet} pet - 進化後のPet（imageDataは進化済みBlob）
 * @param {number} stage - 進化後stage（1 or 2）
 */
function showEvolutionOverlay(pet, stage) {
  let overlay = document.getElementById('overlay-evolution');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'overlay-evolution';
    overlay.className = 'overlay';
    overlay.innerHTML = `
      <div class="overlay-card">
        <h3 id="evolution-title"></h3>
        <canvas id="evolution-pet-canvas" width="100" height="100" style="border-radius:18px;margin:4px 0"></canvas>
        <div id="evolution-body" style="font-size:13px;color:var(--color-text-light)"></div>
        <button class="btn-primary" id="evolution-ok-btn">OK</button>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  document.getElementById('evolution-title').textContent = stage === 1 ? '✨ 進化した！' : '🌟 さらに進化した！';
  document.getElementById('evolution-body').textContent  = stage === 1 ? '見た目が鮮やかになった！' : '神々しく輝いている！';
  drawPetToCanvas(pet, document.getElementById('evolution-pet-canvas'), 100, 18);
  overlay.classList.remove('hidden');
  document.getElementById('evolution-ok-btn').onclick = () => overlay.classList.add('hidden');
  overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.add('hidden'); };
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
