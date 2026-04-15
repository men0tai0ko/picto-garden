# アーキテクチャ architecture.md

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
  id: string/number,
  typeIndex: number,     // encyclopediaFlags・アニメクラスの添字
  type: string,          // 種類ラベル文字列
  level: number,
  hp: number,        // 上限100
  mp: number,        // 上限100
  attack: number,    // 上限100
  defense: number,   // 上限100
  hunger: number,
  personalityIndex: number, // 成長補正参照用インデックス
  personality: string,      // 性格ラベル文字列
  attribute: string, // 火/水/草/闇/光
  rarity: string,    // 将来拡張
  imageData: Blob    // 元画像
}
```

### User

```
{
  level: number,              // 上限50
  exp: number,                // Lv50後は0固定
  currency: number,           // 初期100
  pets: string[],             // 所持PetのIDリスト
  gardenSlots: number,        // 初期1・最大5
  gardenPetIds: string[],     // 庭に表示中のPet IDリスト（上限=gardenSlots）
  encyclopediaFlags: boolean[5] // 図鑑解放フラグ（種類順）
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
        └── 5種類の解放状況表示（未解放はシルエット）
```

---

## 6. petGeneratorフロー

```
[画像入力]
  → Canvas APIでピクセルデータ取得（getImageData）
  → 色解析関数    → 平均RGB → 属性（火/水/草/闇/光）
  → 輪郭解析関数  → エッジ検出 → 種類（5種）
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
  → 勝率計算（総合力 ÷ 難易度、0.1〜0.9クランプ）
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
