/**
 * script.js — エントリポイント
 * T1対象：ペット生成UI・画面遷移・ステータスバー・ケージ表示・図鑑表示
 */

import { initDB, getUser, saveUser, getAllPets, getPet, registerNewPet } from './state.js';
import { generatePetFromImage, PET_TYPES, PERSONALITIES } from './petGenerator.js';

// ===== 起動 =====
(async () => {
  try {
    await initDB();
    await renderStatusBar();
    await renderEncyclopedia();
    await renderCage();
    await renderGarden();
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
  `;

  panel.classList.remove('hidden');
  panel.classList.add('open');

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
