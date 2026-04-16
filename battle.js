/**
 * battle.js — 訓練（オートバトル）・報酬ループ
 * architecture.md準拠：勝率計算・報酬算出・HP減少・EXP/レベルアップ
 * 通貨増減はeconomy.js経由のみ
 */

import { getUser, saveUser, getPet, savePet } from './state.js';
import { earnCurrency } from './economy.js';
import { SKILLS } from './petGenerator.js';

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

/** スキル発動確率・MP消費量 */
const SKILL_ACTIVATE_PROB  = 0.30;
export const SKILL_MP_COST = 20;

/** レベル上限（spec.md 6） */
const USER_LEVEL_CAP = 50;

// ===== 属性相性（S拡張：属性相性） =====

/** 敵属性候補（petGenerator.js ATTRIBUTES と同順） */
export const ENEMY_ATTRIBUTES = ['火', '水', '草', '闇', '光'];

/** 属性相性乗数テーブル（攻撃側 → 敵側 → 乗数） */
const AFFINITY_TABLE = {
  '火': { '火': 1.0, '水': 0.8, '草': 1.2, '闇': 1.0, '光': 1.0 },
  '水': { '火': 1.2, '水': 1.0, '草': 0.8, '闇': 1.0, '光': 1.0 },
  '草': { '火': 0.8, '水': 1.2, '草': 1.0, '闇': 1.0, '光': 1.0 },
  '闇': { '火': 1.0, '水': 1.0, '草': 1.0, '闇': 1.0, '光': 0.8 },
  '光': { '火': 1.0, '水': 1.0, '草': 1.0, '闇': 1.2, '光': 1.0 },
};

/** 敵属性をランダムに1件返す純粋関数 */
export function pickEnemyAttribute() {
  return ENEMY_ATTRIBUTES[Math.floor(Math.random() * ENEMY_ATTRIBUTES.length)];
}

/**
 * 属性相性乗数を返す純粋関数
 * @param {string} petAttr - 自ペット属性
 * @param {string} enemyAttr - 敵属性
 * @returns {number} 乗数（フォールバック: 1.0）
 */
export function getAffinityMultiplier(petAttr, enemyAttr) {
  return AFFINITY_TABLE[petAttr]?.[enemyAttr] ?? 1.0;
}

// ===== メインバトル関数 =====

/**
 * バトル実行
 * @param {string} petId
 * @param {'easy'|'normal'|'hard'} difficultyId
 * @param {string} enemyAttribute - 敵属性（pickEnemyAttribute()で事前抽選済み）
 * @returns {Promise<BattleResult>}
 */
export async function runBattle(petId, difficultyId, enemyAttribute) {
  const pet  = await getPet(petId);
  const user = await getUser();

  // 訓練不可ガード
  if (pet.hp <= 0)     return { ok: false, reason: 'HP0' };
  if (pet.hunger <= 0) return { ok: false, reason: 'HUNGER0' };

  const diff = DIFFICULTY_LEVELS.find(d => d.id === difficultyId) ?? DIFFICULTY_LEVELS[1];

  // 計算式（spec.md 4.1）+ 属性相性乗数
  const power          = pet.hp + pet.mp + pet.attack + pet.defense;
  const baseDiff       = user.level * 10 + power * 0.5;
  const difficulty     = baseDiff * diff.coeff;
  const affinityMult   = getAffinityMultiplier(pet.attribute, enemyAttribute);

  // スキル発動判定（MP>0 かつ確率判定）
  const skill = SKILLS[pet.personalityIndex] ?? SKILLS[4];
  const skillActivated = pet.mp > 0 && Math.random() < SKILL_ACTIVATE_PROB;
  const skillBonus     = skillActivated ? skill.winRateBonus : 0;
  if (skillActivated) {
    pet.mp = Math.max(0, pet.mp - SKILL_MP_COST);
  }

  const winRate        = Math.min(WIN_RATE_MAX, Math.max(WIN_RATE_MIN, (power / difficulty) * affinityMult + skillBonus));
  const won            = Math.random() < winRate;

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
    enemyAttribute,
    affinityMult,
    skillActivated,
    skillName:       skillActivated ? skill.label : null,
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
