/**
 * battle.js — 訓練（オートバトル）・報酬ループ
 * architecture.md準拠：勝率計算・報酬算出・HP減少・EXP/レベルアップ
 * 通貨増減はeconomy.js経由のみ
 */

import { getUser, saveUser, getPet, savePet } from './state.js';
import { earnCurrency } from './economy.js';

// ===== 外部定数（tasks.md注意事項：難易度倍率は外部定数） =====

/** 難易度3段階 */
export const DIFFICULTY_LEVELS = [
  { id: 'easy',   label: 'やさしい', coeff: 0.5 },
  { id: 'normal', label: 'ふつう',   coeff: 1.0 },
  { id: 'hard',   label: 'むずかしい', coeff: 1.5 },
];

/** 勝率クランプ */
const WIN_RATE_MIN = 0.1;
const WIN_RATE_MAX = 0.9;

/** HP減少量（勝利・敗北共通） */
const HP_LOSS_WIN  = 10;
const HP_LOSS_LOSE = 20;

/** 通貨報酬上限（spec.md 5） */
const REWARD_CURRENCY_CAP = 200;

/** レベル上限（spec.md 6） */
const USER_LEVEL_CAP = 50;

// ===== メインバトル関数 =====

/**
 * バトル実行
 * @param {string} petId
 * @param {'easy'|'normal'|'hard'} difficultyId
 * @returns {Promise<BattleResult>}
 */
export async function runBattle(petId, difficultyId) {
  const pet  = await getPet(petId);
  const user = await getUser();

  // 訓練不可ガード
  if (pet.hp <= 0)     return { ok: false, reason: 'HP0' };
  if (pet.hunger <= 0) return { ok: false, reason: 'HUNGER0' };

  const diff = DIFFICULTY_LEVELS.find(d => d.id === difficultyId) ?? DIFFICULTY_LEVELS[1];

  // 計算式（spec.md 4.1）
  const power     = pet.hp + pet.mp + pet.attack + pet.defense;
  const baseDiff  = user.level * 10 + power * 0.5;
  const difficulty = baseDiff * diff.coeff;
  const winRate   = Math.min(WIN_RATE_MAX, Math.max(WIN_RATE_MIN, power / difficulty));
  const won       = Math.random() < winRate;

  // HP減少
  const hpLoss = won ? HP_LOSS_WIN : HP_LOSS_LOSE;
  pet.hp = Math.max(0, pet.hp - hpLoss);
  await savePet(pet);

  let expGained      = 0;
  let currencyGained = 0;
  let leveledUp      = false;
  let newLevel       = user.level;

  if (won) {
    // EXP・通貨付与（spec.md 4.1）
    expGained      = Math.floor(difficulty * 0.5);
    currencyGained = Math.min(REWARD_CURRENCY_CAP, Math.floor(8 * user.level * diff.coeff));
    await earnCurrency(currencyGained);

    // レベルアップ処理（T5：1回で1Lv・上限50）
    const result = await applyExp(null, expGained);
    leveledUp = result.leveledUp;
    newLevel  = result.level;
  }

  return {
    ok:              true,
    won,
    winRate:         Math.round(winRate * 100),
    hpLoss,
    expGained,
    currencyGained,
    leveledUp,
    newLevel,
    petHpAfter:      pet.hp,
    difficulty:      Math.round(difficulty),
    power,
  };
}

// ===== T5：EXP・レベルアップ =====

/**
 * EXP加算・レベルアップ処理
 * 注意：レベルアップは1回で1Lv。難易度再計算はレベルアップ確定後（呼び出し側）
 */
async function applyExp(_, amount) {
  // earnCurrency保存後の最新userを取得して上書きを防ぐ
  const user = await getUser();

  if (user.level >= USER_LEVEL_CAP) {
    user.exp = 0;
    await saveUser(user);
    return { leveledUp: false, level: user.level };
  }

  user.exp += amount;
  const needed = user.level * 100;
  let leveledUp = false;

  if (user.exp >= needed) {
    user.exp   = 0; // 余剰切り捨て（1回で1Lv）
    user.level = Math.min(USER_LEVEL_CAP, user.level + 1);
    leveledUp  = true;
  }

  await saveUser(user);
  return { leveledUp, level: user.level };
}
