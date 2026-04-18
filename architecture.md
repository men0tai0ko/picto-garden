# アーキテクチャ architecture.md
<!-- 正本：モジュール構成・データフロー・永続化・実装制約 -->
<!-- 数値・計算式 → spec.md -->
<!-- カラー・レイアウト → ui.md -->

## 1. 全体構成

ブラウザゲーム（HTML/CSS/JavaScript 単体構成・ブラウザ完結）

```
[ブラウザ]
  └── index.html
  └── style.css
  └── script.js（エントリポイント）
       ├── petGenerator.js（画像→ペット変換）
       ├── battle.js（訓練・オートバトル）
       ├── economy.js（通貨・餌・報酬）
       └── state.js（ゲーム状態管理・IndexedDB）
```

---

## 2. データモデル

### Pet

```
{
  id: string,
  name: string,              // 表示名（最大6文字・リネーム可）
  typeIndex: number,         // encyclopediaFlags配列の添字（0〜9）
  type: string,              // PET_TYPES[typeIndex].label（10種）
  level: number,
  hp: number,
  mp: number,
  attack: number,
  defense: number,
  hunger: number,
  personalityIndex: number,  // PERSONALITIES配列の添字（0〜4）
  personality: string,       // PERSONALITIES[personalityIndex].label
  skill: string,             // SKILLS[personalityIndex].id（性格と1対1）
  attribute: string,         // 火/水/草/闇/光
  rarity: string,            // 伝説/英雄/希少/高級/一般
  imageData: Blob,           // 元画像（IndexedDB保存）
  evolutionStage: number,    // 0/1/2
  statCaps: { hp, mp, attack, defense }, // calcStatCaps()による可変上限
  generation: number         // 繁殖世代（直接生成=1・バッジなし、繁殖子=親の最大世代+1・2世以上でバッジ表示）
}
```

### User

```
{
  level: number,              // 上限50
  exp: number,                // Lv50後は0固定
  currency: number,           // 初期100
  pets: Pet[],
  gardenSlots: number,        // 初期1・最大5
  encyclopediaFlags: boolean[10] // 図鑑解放フラグ（typeIndexと対応）
}
```

---

## 3. 永続化

| 項目 | 内容 |
|------|------|
| 方式 | IndexedDB |
| 画像保存 | PetオブジェクトにBlob紐付け |
| バックエンド | なし |

### IndexedDBストア構成

| ストア名 | キー | 内容 |
|---------|------|------|
| pets | id | Petオブジェクト（imageData: Blob含む） |
| user | fixed("user") | Userオブジェクト |

---

## 4. モジュール責務

| モジュール | 責務 |
|-----------|------|
| petGenerator | 画像解析（色・輪郭・輝度・ノイズ）→ Petオブジェクト生成。各ステップは独立関数 |
| battle | 勝率計算・オートバトル進行・報酬算出・HP減少。難易度倍率は外部定数 |
| economy | 通貨増減の一元管理。他モジュールから直接通貨変更禁止 |
| state | User・Petデータの保持・更新・IndexedDB読み書き |

---

## 5. 画面遷移

```
ホーム（庭）
  ├── タップ → 下部パネルスライドイン（ステータス・空腹度・HP・種類・性格）
  ├── ケージ画面
  │     └── ペット選択 → 庭に反映
  ├── 生成画面
  │     └── 画像アップロード → petGenerator → IndexedDB保存 → ケージに追加
  ├── ショップ
  │     └── 餌購入 → economy.js → currency減少
  ├── 訓練画面
  │     └── 難易度選択（3段階）→ オートバトル → EXP・通貨獲得・HP減少
  └── 図鑑
        └── 10種類の解放状況表示（未解放はシルエット）
```

---

## 6. petGeneratorフロー

```
[画像入力]
  → Canvas APIでピクセルデータ取得（getImageData）
  → 色解析関数    → 平均RGB → 属性（火/水/草/闇/光）
  → 輪郭解析関数  → エッジ検出 → 種類（10種）
  → 明るさ解析関数 → 輝度平均 → 性格（5種）
  → ノイズ解析関数 → 分散 → レア度
  → Petオブジェクト生成 → IndexedDB保存
```

各解析ステップは独立関数（後から差し替え可能）

---

## 7. battleフロー

```
[難易度選択]
  → 空腹度0 or HP0 チェック（訓練不可ガード）
  → 難易度計算（ユーザーLv×10 + 総合力×0.5）× 難易度係数
  → 属性相性乗数取得（AFFINITY_TABLE: 自属性 × 敵属性 → 1.2/1.0/0.8）
  → スキル発動判定（MP>0 かつ30%確率 → winRateBonus加算・MP-20）
  → 勝率計算（（総合力 ÷ 難易度）× 属性相性 + スキルボーナス、0.1〜0.9クランプ）
  → 勝敗判定
  → 勝利：EXP・通貨付与（上限200）・HP減少
  → 敗北：HP減少のみ
  → state.js へ結果反映 → IndexedDB書き込み
```

---

## 8. 訓練不可条件

| 条件 | 解除方法 |
|------|---------|
| HP = 0 | 餌やりでHP+20回復 |
| 空腹度 = 0 | 餌やりで空腹度回復 |

---

## 9. 実装制約

変更・拡張時に必ず守る制約。

| 制約 | 理由 |
|------|------|
| 通貨増減は economy.js 経由のみ | 直接変更すると残高整合性が壊れる |
| 難易度再計算はレベルアップ確定後に実施 | 同バトル内での数値不整合防止 |
| 閾値・係数はすべて外部定数として定義 | 後調整を容易にする |
| petGeneratorの各解析ステップは独立関数 | 差し替え可能な構造を維持する |
| 属性相性テーブル（AFFINITY_TABLE）はbattle.jsの外部定数 | 変更箇所を一箇所に集約する |
| 敵属性はbattleStateに保存・バトル終了後nullリセット | 次回表示時に再抽選するため |
| 庭スロット拡張は起動時 `syncGardenSlots()` で自動補正 | 既存データとの不整合防止 |
| 属性（fire/water/草/dark/light）はenumで管理 | 将来拡張時の一貫性維持 |
| gardenSlotsはUserオブジェクトで管理（固定値にしない） | 庭スロット拡張機能の前提 |
