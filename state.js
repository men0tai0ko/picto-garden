/**
 * state.js — ゲーム状態管理・IndexedDB永続化
 * T1対象：初期化・Pet保存・User保存・読み込み
 */

const DB_NAME    = 'picto-garden';
const DB_VERSION = 1;
const STORE_PETS = 'pets';
const STORE_USER = 'user';
const USER_KEY   = 'user';

let db = null;

/** IndexedDB初期化。他モジュールはawait initDB()後に使用 */
export async function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_PETS)) {
        d.createObjectStore(STORE_PETS, { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains(STORE_USER)) {
        d.createObjectStore(STORE_USER);
      }
    };

    req.onsuccess  = (e) => { db = e.target.result; resolve(db); };
    req.onerror    = (e) => reject(e.target.error);
  });
}

// ===== User =====

/** Userオブジェクト取得。存在しない場合は初期値を返す */
export async function getUser() {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_USER, 'readonly');
    const req = tx.objectStore(STORE_USER).get(USER_KEY);
    req.onsuccess = (e) => {
      resolve(e.target.result ?? createDefaultUser());
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

/** UserオブジェクトをIndexedDBに保存 */
export async function saveUser(user) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_USER, 'readwrite');
    const req = tx.objectStore(STORE_USER).put(user, USER_KEY);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

function createDefaultUser() {
  return {
    level:              1,
    exp:                0,
    currency:           100,
    pets:               [],        // Pet id の配列
    gardenSlots:        1,
    gardenPetIds:       [],        // 庭に出中のPet id
    encyclopediaFlags:  [false, false, false, false, false],
  };
}

// ===== Pet =====

/** Pet一覧を全件取得 */
export async function getAllPets() {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_PETS, 'readonly');
    const req = tx.objectStore(STORE_PETS).getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/** Pet1件取得 */
export async function getPet(id) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_PETS, 'readonly');
    const req = tx.objectStore(STORE_PETS).get(id);
    req.onsuccess = (e) => resolve(e.target.result ?? null);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/** Petを保存（新規・更新共通） */
export async function savePet(pet) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE_PETS, 'readwrite');
    const req = tx.objectStore(STORE_PETS).put(pet);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * ペット生成後の一括保存処理
 * - Petオブジェクト保存
 * - User.pets配列更新
 * - User.encyclopediaFlags更新
 */
export async function registerNewPet(pet) {
  await savePet(pet);

  const user = await getUser();
  if (!user.pets.includes(pet.id)) {
    user.pets.push(pet.id);
  }
  // 図鑑解放フラグ更新（PET_TYPES順と一致）
  user.encyclopediaFlags[pet.typeIndex] = true;
  await saveUser(user);
  return user;
}
