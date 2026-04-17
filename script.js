/**
 * script.js — エントリポイント
 * T1：ペット生成UI・画面遷移・ステータスバー・ケージ表示・図鑑表示
 * T2：庭表示・下部パネル
 * T3：餌システム（ショップUI・餌購入・ステータス上昇）
 * T4：訓練画面UI・オートバトル
 * T5：報酬ループ（EXP・レベルアップ・レベルアップ演出）
 */

import { initDB, getUser, saveUser, getAllPets, getPet, savePet, registerNewPet, deletePet } from './state.js';
import { generatePetFromImage, PET_TYPES, PERSONALITIES, breedPet, BREED_COST_MULTIPLIER, BREED_HUNGER_MIN, BREED_PET_CAP } from './petGenerator.js';
import { spendCurrency, earnCurrency } from './economy.js';
import { runBattle, DIFFICULTY_LEVELS, pickEnemyAttribute, getAffinityMultiplier } from './battle.js';

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
  // cage-footer表示制御
  document.body.classList.toggle('screen-cage',  name === 'cage');
  document.body.classList.toggle('screen-breed', name === 'breed');
  // 繁殖画面から離れる時に選択状態をリセット
  if (name !== 'breed') selectedBreedIds = [];
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
/** 繁殖画面の選択状態（画面再描画をまたいで保持） */
let selectedBreedIds = [];

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
    renderBreed();
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
    canvas.className = `garden-pet ${PET_TYPES[pet.typeIndex]?.animClass ?? ''} ${getEvolutionClass(pet.evolutionStage ?? 0)}`.trimEnd();
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

    // アイコン＋名前をwrapperで包んで縦並び
    const petWrapper = document.createElement('div');
    petWrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px';
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

  const inGarden = user.gardenPetIds.includes(pet.id);
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
    <div style="font-size:11px;color:var(--color-mp);margin-bottom:8px">✨ スキル: ${pet.skill ?? '—'}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-bottom:6px">
      ${statBar('HP',    pet.hp,     'hp')}
      ${statBar('MP',    pet.mp,     'mp')}
      ${statBar('攻撃',  pet.attack, 'atk')}
      ${statBar('防御',  pet.defense,'def')}
    </div>
    ${statBar('空腹度', pet.hunger, 'hunger')}
    <div style="margin-top:14px;display:flex;gap:10px;justify-content:center">
      <button class="btn-primary" id="panel-feed-btn" style="padding:10px 20px;font-size:14px">🍖 餌 🪙${price}</button>
      <button class="btn-primary" id="panel-water-btn" style="padding:10px 20px;font-size:14px;background:var(--color-mp)">💧 おみず</button>
    </div>
    <button id="panel-garden-btn" class="btn-primary" style="width:100%;margin-top:10px;font-size:14px;background:${inGarden ? 'var(--color-ground)' : 'var(--color-main)'}">
      ${inGarden ? '🏡 庭から外す' : '🌿 庭に出す'}
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
    // ケージカードの名前を即時反映
    const cageScreen = document.getElementById('screen-cage');
    const card = cageScreen.querySelector(`[data-cage-card="${pet.id}"]`);
    const u = await getUser();
    if (card) updateCageCard(card, fresh, u);
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
        showPetPanel(fresh);
        // ケージカードの名前を即時反映
        const cageScreen = document.getElementById('screen-cage');
        const card = cageScreen.querySelector(`[data-cage-card="${pet.id}"]`);
        const u = await getUser();
        if (card) updateCageCard(card, fresh, u);
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
        // 自然回復（空腹度>0のペットのみ）
        pet.hp = Math.min(STAT_CAP, (pet.hp ?? 0) + 5);
        pet.mp = Math.min(STAT_CAP, (pet.mp ?? 0) + 5);
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
  '伝説': 0.30,
  '英雄': 0.20,
  '希少': 0.10,
  '高級': 0.05,
  '一般': 0.02,
};

/** 通常成長：+1〜+5 */
const STAT_GROWTH_MIN = 1;
const STAT_GROWTH_MAX = 5;

/** 餌の空腹回復量 */
const FEED_HUNGER_RESTORE = 20;

/** ステータス上限 */
const STAT_CAP = 100;

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

  // 全ステータスが上限か判定（攻撃・防御のみ対象）
  const allCapped = fresh.attack >= STAT_CAP && fresh.defense >= STAT_CAP;

  if (!allCapped) {
    const bonus      = PERSONALITY_BONUS[fresh.personalityIndex] ?? PERSONALITY_BONUS[4];
    const growthProb = RARITY_GROWTH_PROB[fresh.rarity] ?? RARE_GROWTH_PROB;

    const applyGain = (stat) => {
      if (fresh[stat] >= STAT_CAP) return;
      const isBonusStat = bonus.stat === stat || bonus.stat === 'all';
      const gain = calcStatGain(fresh[stat], isBonusStat, bonus.mult, growthProb);
      fresh[stat] = Math.min(STAT_CAP, fresh[stat] + gain);
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
  fresh.hp = Math.min(100, fresh.hp + 10);
  fresh.mp = Math.min(100, fresh.mp + 10);
  await savePet(fresh);
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
                 : selectedPet.hunger <= 0 ? '空腹度0のため訓練不可（餌で回復）'
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
          <div style="font-size:11px;color:var(--color-text-light)">${selectedPet.type} / ${selectedPet.personality} / ${selectedPet.attribute}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-bottom:6px">
        ${statBar('HP',   selectedPet.hp,      'hp')}
        ${statBar('MP',   selectedPet.mp,      'mp')}
        ${statBar('攻撃', selectedPet.attack,  'atk')}
        ${statBar('防御', selectedPet.defense, 'def')}
      </div>
      ${statBar('満腹度', selectedPet.hunger, 'hunger')}
      <div style="display:flex;gap:6px;margin-top:10px">
        <button id="battle-feed-btn" class="btn-buy" style="flex:1;font-size:12px;padding:7px 0">🍖 餌 🪙${price}</button>
        <button id="battle-water-btn" class="btn-buy" style="flex:1;font-size:12px;padding:7px 0;background:var(--color-mp)">💧 水</button>
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
    const logEl = document.getElementById('battle-log');
    const scrollTop = logEl ? logEl.scrollTop : 0;
    await renderBattle();
    await renderStatusBar();
    await renderCage();
    await renderGarden();
    const logElAfter = document.getElementById('battle-log');
    if (logElAfter) logElAfter.scrollTop = scrollTop;
    if (result.evolved && updated) showEvolutionOverlay(updated, result.evolutionStage);
  });

  // 訓練画面：水あげボタン
  document.getElementById('battle-water-btn').addEventListener('click', async () => {
    const btn = document.getElementById('battle-water-btn');
    btn.disabled = true;
    const fresh = await getPet(battleState.petId);
    if (!fresh) { btn.disabled = false; return; }
    await waterPet(fresh);
    const logEl = document.getElementById('battle-log');
    const scrollTop = logEl ? logEl.scrollTop : 0;
    await renderBattle();
    await renderStatusBar();
    await renderCage();
    await renderGarden();
    const logElAfter = document.getElementById('battle-log');
    if (logElAfter) logElAfter.scrollTop = scrollTop;
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
    const resultCanvas = document.getElementById('battle-result-pet-canvas');
    drawPetToCanvas(pet, resultCanvas, 72, 12);
    resultCanvas.classList.remove('evo-stage-1', 'evo-stage-2');
    const evoClass = getEvolutionClass(pet.evolutionStage ?? 0);
    if (evoClass) resultCanvas.classList.add(evoClass);
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
  const pets = await getAllPets();
  for (const pet of pets) {
    if (RARITY_MIGRATION[pet.rarity]) {
      pet.rarity = RARITY_MIGRATION[pet.rarity];
      await savePet(pet);
    }
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

// ===== 繁殖画面 =====

/**
 * 繁殖画面を描画する（screen-breed内）
 * selectedBreedIdsはモジュール変数で保持
 */
async function renderBreed() {
  const area = document.getElementById('breed-area');
  const latestPets = await getAllPets();
  const latestUser = await getUser();
  const cost = BREED_COST_MULTIPLIER * latestUser.level;

  // コスト説明
  area.innerHTML = `
    <p style="font-size:12px;color:var(--color-text-light);margin:0">
      2体選択・空腹度${BREED_HUNGER_MIN}以上が必要 / 🪙${cost}
    </p>
  `;

  // ペットリスト
  latestPets.forEach(pet => {
    const isSelected = selectedBreedIds.includes(pet.id);
    const canSelect  = pet.hunger >= BREED_HUNGER_MIN;
    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:center;gap:10px;background:${isSelected ? 'rgba(125,184,122,0.15)' : 'var(--color-white)'};border-radius:10px;padding:8px 12px;cursor:${canSelect ? 'pointer' : 'default'};border:2px solid ${isSelected ? 'var(--color-main)' : 'transparent'};opacity:${canSelect ? '1' : '0.45'};box-shadow:var(--shadow)`;

    const canvas = document.createElement('canvas');
    canvas.width = 40; canvas.height = 40;
    canvas.style.cssText = 'border-radius:8px;flex-shrink:0';
    drawPetToCanvas(pet, canvas, 40, 6);

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0';
    info.innerHTML = `
      <div style="font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${pet.name ?? pet.type}</div>
      <div style="font-size:10px;color:var(--color-text-light)">${pet.type} / 空腹${pet.hunger}</div>
    `;

    if (canSelect) {
      row.addEventListener('click', () => {
        if (isSelected) {
          selectedBreedIds = selectedBreedIds.filter(id => id !== pet.id);
        } else if (selectedBreedIds.length < 2) {
          selectedBreedIds.push(pet.id);
        }
        renderBreed();
      });
    }
    row.append(canvas, info);
    area.appendChild(row);
  });

  // footerボタン状態更新
  const execBtn = document.getElementById('breed-footer-exec');
  execBtn.disabled = selectedBreedIds.length !== 2;

  execBtn.onclick = async () => {
    if (selectedBreedIds.length !== 2) return;
    execBtn.disabled = true;

    // 所持上限チェック
    const allPets = await getAllPets();
    if (allPets.length >= BREED_PET_CAP) {
      alert(`ペットの所持上限（${BREED_PET_CAP}体）に達しています`);
      execBtn.disabled = false; return;
    }

    // 通貨消費
    const currentUser = await getUser();
    const currentCost = BREED_COST_MULTIPLIER * currentUser.level;
    const { ok } = await spendCurrency(currentCost);
    if (!ok) {
      alert(`通貨が足りません（必要: 🪙${currentCost}）`);
      execBtn.disabled = false; return;
    }

    // 親データ取得
    const [pA, pB] = await Promise.all([getPet(selectedBreedIds[0]), getPet(selectedBreedIds[1])]);
    if (!pA || !pB) { execBtn.disabled = false; return; }

    // 子生成・保存
    const inheritedBlob = Math.random() < 0.5 ? pA.imageData : pB.imageData;
    const child = breedPet(pA, pB, inheritedBlob);
    await registerNewPet(child);

    selectedBreedIds = [];
    await renderStatusBar();
    await renderEncyclopedia();
    await renderCage();
    showBreedResultOverlay(child);
  };

  document.getElementById('breed-footer-cancel').onclick = () => {
    switchScreen('cage');
    document.querySelectorAll('.nav-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.screen === 'cage')
    );
  };
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
