/**
 * economy.js — 通貨増減の一元管理
 * 他モジュールから直接通貨変更禁止（architecture.md準拠）
 */

import { getUser, saveUser } from './state.js';

/**
 * 通貨消費。残高不足時は false を返す
 * @param {number} amount - 消費量（正の整数）
 * @returns {Promise<{ok: boolean, currency: number}>}
 */
export async function spendCurrency(amount) {
  const user = await getUser();
  if (user.currency < amount) return { ok: false, currency: user.currency };
  user.currency -= amount;
  await saveUser(user);
  return { ok: true, currency: user.currency };
}

/**
 * 通貨加算
 * @param {number} amount - 加算量（正の整数）
 * @returns {Promise<number>} 加算後残高
 */
export async function earnCurrency(amount) {
  const user = await getUser();
  user.currency += amount;
  await saveUser(user);
  return user.currency;
}

/** 現在の通貨残高を返す */
export async function getCurrency() {
  const user = await getUser();
  return user.currency;
}
