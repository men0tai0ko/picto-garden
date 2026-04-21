# 実装記録
<!-- 正本：タスク進捗・バグ修正履歴・改善提案 -->
<!-- 仕様数値 → spec.md　設計制約 → architecture.md -->

## 実装優先順位

| 順序 | タスク | 依存 | 状態 |
|------|--------|------|------|
| 1 | T1 ペット生成 | なし | **実装完了** |
| 1 | T2 庭表示 | T1 | **実装完了** |
| 1 | T3 餌システム | T2 | **実装完了** |
| 2 | T4 訓練 | T3 | **実装完了** |
| 3 | T5 報酬ループ | T4 | **実装完了** |
| 4 | T6 図鑑 | T1 | **実装完了** |
| 4 | T7 スキル・属性相性・レア度 | T4 | **実装完了** |
| 1 | T8 繁殖 | T1 | **実装完了** |
| 2 | T9 見た目変化（進化） | T3 | **実装完了** |
| 2 | T10 ペット名称・削除 | T2 | **実装完了** |
| 4 | T11 庭時刻帯演出 | T2 | **実装完了** |

---

## T1：ペット生成

- [x] 画像アップロードUI実装
- [x] Canvas APIでピクセルデータ取得処理
- [x] 色解析関数（平均RGB → 属性）
- [x] 輪郭解析関数（エッジ検出 → 種類）
- [x] 明るさ解析関数（輝度平均 → 性格）
- [x] ノイズ解析関数（分散 → レア度）
- [x] Petオブジェクト生成関数
- [x] 元画像をBlobとしてIndexedDBに保存
- [x] 図鑑解放フラグ更新処理

---

## T2：庭表示

- [x] 庭UIコンポーネント実装
- [x] IndexedDBからPet取得・表示処理（非同期・フォールバックあり）
- [x] Canvas APIで正方形クロップ・角丸処理
- [x] 種類別CSSアニメーション実装（10種）
- [x] タップ → 下部固定パネルスライドイン実装
- [x] パネル表示内容：ステータス・空腹度・HP・種類・性格
- [x] ケージ画面UI実装
- [x] 庭に出すペット選択・gardenSlots管理

---

## T3：餌システム

- [x] ショップUI実装
- [x] 餌購入処理（通貨残高チェック → economy.js経由で消費）
- [x] 空腹度回復処理
- [x] HP+20回復処理
- [x] ステータスランダム上昇ロジック（性格補正乗算）
- [x] 確率減衰処理（70%・90%境界の3段階）
- [x] 全ステータス上限到達後はHP回復のみ発動（`FEED_HP_RESTORE=20`・`allCapped`判定で分岐）

---

## T4：訓練

- [x] 訓練画面UI実装（3段階難易度選択）
- [x] 訓練不可ガード（HP0・空腹度0チェック）
- [x] 難易度計算（ユーザーLv×10 + 総合力×0.5）× 難易度係数
- [x] 勝率計算（0.1〜0.9クランプ）
- [x] 勝敗判定処理
- [x] 勝利時：EXP・通貨付与（上限200）・HP減少
- [x] 敗北時：HP減少のみ
- [x] 難易度倍率（×0.5/×1.0/×1.5）は外部定数として定義

---

## T5：報酬ループ

- [x] EXP加算処理
- [x] レベルアップ判定（必要EXP = ユーザーLv × 100）
- [x] Lv50上限処理（到達後EXPは0固定）
- [x] レベルアップ後の難易度即時再計算
- [x] state.jsへの結果反映 → IndexedDB書き込み

---

## T6：図鑑

- [x] 図鑑UIコンポーネント実装
- [x] 10種類の解放状況表示
- [x] 未解放種：シルエット表示（Canvas APIで黒塗り処理）
- [x] 解放済み種：通常表示
- [x] encyclopediaFlagsのIndexedDB永続化
- [x] petGenerator生成時の解放フラグ自動更新

---

## T7：スキル・属性相性・レア度

- [x] SKILLS定義（性格と1対1対応・petGenerator.js）
- [x] スキル発動判定（MP>0・30%確率・MP-20・battle.js）
- [x] winRateBonus加算・クランプ再適用
- [x] 属性相性テーブル（AFFINITY_TABLE・battle.js外部定数）
- [x] 敵属性ランダム抽選（pickEnemyAttribute・battleState保存）
- [x] レア度5段階（伝説/英雄/希少/高級/一般・petGenerator.js）
- [x] レア度別ボーナス確率（RARITY_GROWTH_PROB・script.js）
- [x] レア度別statCapsボーナス（calcStatCaps・petGenerator.js）

---

## T8：繁殖

- [x] 繁殖UIボタン（ケージ画面）
- [x] 繁殖コスト処理（🪙50×ユーザーLv・economy.js経由）
- [x] 繁殖条件チェック（満腹度≥50・所持≤20・evolutionStage≥2）
- [x] 子パラメータ生成（breedPet()・親どちらかの画像をそのまま継承）
- [x] 世代管理（generation フィールド・世代バッジ表示）

---

## T9：見た目変化（進化）

- [x] evolutionStageフィールド（0/1/2）
- [x] 進化チェック（feedPet内・総合力閾値100→300）
- [x] 進化フレーム枠（evo-stage-1: シルバー / evo-stage-2: ゴールド）
- [x] getEvolutionClass()ヘルパー（一元管理）
- [x] 進化オーバーレイ演出
- [x] 適用箇所：庭・ケージ・訓練（選択欄・ステータス欄・結果overlay）

---

## T10：ペット名称・削除

- [x] ランダム名生成（generateName()・形容詞×名詞・最大6文字）
- [x] リネーム機能（庭パネルの✏️ボタン・インラインinput）
- [x] 確定: blur/Enter・キャンセル: Escape
- [x] ペット削除（野に放つ）：ケージ編集モード・確認ダイアログ
- [x] 庭在中ペットの削除不可ガード

---

## T11：庭時刻帯演出

- [x] getCurrentTimeSlot()：時刻→時刻帯クラス名（4区分）を返す
- [x] applyGardenTime()：`#screen-garden` の `time-*` クラスを付け替える
- [x] switchScreen()に庭進入時interval開始・離脱時clearIntervalを追加
- [x] style.css：`#garden-sky` / `#garden-ground` に `transition: background 3s ease` 追加
- [x] style.css：時刻帯クラス4種（morning/noon/evening/night）を `#screen-garden` スコープで定義
- [x] style.css：`.time-night #garden-sky::after` で星を `box-shadow` 疑似要素として静的配置

---

## 改善提案（未実装）

| # | 提案 | 優先度 | 理由 |
|---|------|--------|------|
| 1 | `wrapWithGenerationBadge` 内の `if (generation >= 2)` 二重チェックを除去 | 中 | 軽微調整 |
| 2 | `onGardenPointerUp` no-op 関数を削除 | 低 | 軽微調整 |
| 3 | 庭アイテム長押し削除（600ms）開始時に枠色変化で視覚フィードバックを追加 | 中 | UX改善 |
| 5 | ケージ0体時に「＋ 生成」ボタン背景色を `--color-accent` に変更して導線を強調 | 中 | 使い勝手向上 |
| 6 | `renderShop` で `maxQty:1` 購入済み建物カードに「購入済み」ラベル表示＋購入ボタン `disabled` 化 | 中 | 使い勝手向上 |
| 7 | 放置収益発生時に庭画面在中なら `+N🪙` トーストを1〜2秒表示 | 低 | UX改善 |
| 8 | `HUNGER_INTERVAL_MS` 定数コメントに spec 参照（§番号）を追記 | 低 | バグ予防 |
| 9 | `showBreedOverlay` の `render()` 内 `getAllPets()` 呼び出しを呼び出し元から引数渡しに変更しDB重複読み取りを削減 | 低 | 軽微調整 |
| 10 | ショップカードで `user.currency < item.price` 時に「通貨不足」ラベルを表示（現在は `disabled` のみで理由が不明） | 中 | 使い勝手向上 |
| 11 | `renderBattle` で `canBlock` 非null時に給餌・水あげボタン以外も `disabled` 化（現在は訓練開始ボタンのみ） | 中 | 使い勝手向上 |
| 9 | ペット名バリデーション失敗時（`NAME_PATTERN` 不一致）に入力欄を赤枠で視覚フィードバック（現在は無音で元の名前に戻るのみ） | 中 | 使い勝手向上 |
| 15 | `renderBattle` のペット選択・難易度変更ごとに全画面 `innerHTML` クリアせず、差分更新範囲を最小化してスクロール退避コードを削減 | 中 | UX改善 |
| 16 | `switchScreen` に `screen-battle` の `body.classList.toggle` 追加（`screen-cage` / `screen-garden` 等は対応済みだが `screen-battle` が未対応） | 低 | バグ予防 |
| 17 | `showLevelUpOverlay` に背景タップ閉じ（`overlay.onclick`）を追加（他overlayには実装済みだが未対応） | 低 | 軽微調整 |
| 18 | `renderGarden` の `for...of` ループ内 `getPet` を `Promise.all` 化して並列取得に変更 | 低 | 軽微調整 |
| 19 | `showEvictDialog` の `getAllPets()` 呼び出しを呼び出し元から引数渡しに変更し DB 二重読み取りを削減 | 低 | 軽微調整 |
| 20 | `RANDOM_PET_NAMES` の送り仮名欠落を修正（例：「やさしイワ」→「やさしいイワ」、「かわいクモ」→「かわいいクモ」） | 低 | 軽微調整 |
| 21 | `wrapWithGenerationBadge` の `badge.style.background = '#FFD700'` をインラインからCSS変数 `--color-accent` に統一 | 低 | 軽微調整 |
| 22 | `initGenerateScreen` の画像ファイルタイプ判定を `['image/jpeg','image/png','image/gif','image/webp']` で明示チェックに変更 | 低 | バグ予防 |
| 23 | `waterPet` の戻り値を `{ ok: boolean }` に変更し `feedPet` と統一してエラーハンドリングを可能にする | 低 | バグ予防 |
| 24 | `overlay-battle-log` / `overlay-battle-result` の再利用判定コメントを追記（初回のみ `createElement`・以降は再利用の動作を明示） | 低 | 軽微調整 |

---

## 改善提案（実装済み）

| 提案 |
|------|
| `showBreedOverlay` で3体目選択試行時にインライン「2体まで選択できます」メッセージ表示 |
| 満腹度タイマーの `showPetPanel` 再描画前に `panel.classList.contains('open')` チェックを追加し画面切替後の誤 open を防止 |
| `showGeneratedOverlay` の `imgEl.onload` で BlobURL を revoke するよう修正（リーク防止） |
| 訓練開始ボタンを満腹度0 / HP0時に `disabled` 化＋ボタン直下に理由テキスト表示 |
| 繁殖overlayの「繁殖！」ボタンを通貨不足時に `disabled` ＋不足額インライン表示 |
| 庭パネルの「おみず」ボタンを水やり後 `btn.disabled = false` で再有効化 |
| `showBreedResultOverlay` 繁殖結果に世代（N世）表示を追加 |
| `feedPet` に `applyGain('hp')` / `applyGain('mp')` を追加（HP/MPが餌で成長しなかったバグ修正） |
| 訓練結果overlayを0戦中断時も表示（「0戦（中断）」タイトル） |
| `showPetPanel` の世代バッジ条件を `generation >= 2` に修正（`wrapWithGenerationBadge` と統一） |
| 庭パネルに「餌をあげる」ボタンを追加 |
| 空腹度を時間経過で減少させる |
| ケージカードに現HPバーを表示 |
| 訓練ログをスクロール位置保持 |
| 生成ボタン連打防止 |
| 訓練画面でペット選択後に空腹度・HP警告をインライン表示 |
| 庭が空のとき「ケージへ」ボタンを表示 |
| 生成画面でペット上限到達時に警告メッセージを表示 |
| ケージカードタップ時に庭スロット満杯の場合、追い出すペット選択UIを表示 |
| パネルの空腹度表示をパーセント数値＋バーに統一 |
| 訓練結果をoverlay-cardで表示 |
| ケージカードのHPバー下に空腹度バーを追加表示 |
| renderBattle内BlobURLをimgEl.onload/onerrorでrevokeObjectURL |
| 庭パネル「餌をあげる」ボタンに現在価格を表示 |
| 図鑑解放済みcanvasにroundRect角丸クリップを追加 |
| 空腹度タイマー発火時にケージ画面が表示中であれば renderCage() を呼び出して更新 |
| 訓練結果overlayにペット画像を追加表示 |
| 訓練画面ステータスカードに給餌ボタン・満腹ゲージ・2列ステータス表示を追加 |
| 訓練開始ボタンを敵属性直下に移動 |
| 庭パネルの属性・等級をバッジ化（青・赤）、HP〜防御を2列グリッド化 |
| 繁殖コスト不足時にケージ画面で金額不足メッセージをインライン表示 |
| 繁殖画面（`_renderBreedArea`）で満腹度不足ペットのカードに「満腹度不足」ラベルを表示 |
| 庭パネルの「庭に出す」ボタンをスロット満杯時に disabled にしてテキストを「庭がいっぱい」に変更 |
| 訓練結果overlayに属性相性1行表示（🔥有利/💧不利/—等倍・敵属性付き） |
| ペット上限到達時にケージ画面上部へ警告バナーを表示 |
| 庭パネルのMP残量をバー表示（statBarで対応済み・HPと同形式） |
| 訓練中モーダルをペット／敵アイコン・種類・属性・HP/MPバー付きの固定高さレイアウトに刷新 |
| 訓練結果モーダルを戦歴リスト（N戦・敵名・勝敗）＋EXP/通貨サマリー＋ログ転写の固定高さレイアウトに刷新 |
| `switchScreen('cage')` 時に `renderCage()` でデータ最新化 |
| 繁殖結果overlayに子ペットのレア度★表示を追加 |
| 庭パネルの餌ボタンを通貨不足時にdisabled化・「通貨不足」表示に変更 |
| `DEBUG_RARITY` フラグ定数追加（`false`）・`analyzeRarity` 内で `variance` をコンソール出力してデバッグを容易化 |
| 庭パネルに「🌿 野に放つ」ボタン追加（庭在中でないペットのみ表示・確認ダイアログへ連携） |
| `showEvictDialog` 追い出しoverlay のペット行にHP・満腹度バー表示を追加 |
| 庭在中ペットの空腹度が0になると庭ナビアイコンに⚠️バッジを表示・解消時に自動除去 |
| `adjustTypeIndex` のコメント誤記修正（「20%の確率」→「40%の確率」） |
| ペット生成時の種類出現率調整（edgeDensity閾値を実測値域に合わせ修正済み） |
| 訓練ログにセッション小計行を追加（N戦・勝敗数・2連勝以上で連勝数表示） |
| 訓練画面の訓練開始ボタン下に敵属性と相性マーク（有利/不利/等倍）をインライン表示 |
| ケージ編集モード時にタイトル行横へ庭スロット残数をインライン表示 |
| 図鑑ヘッダーに解放済み種数カウンター（N/10 解放済み）を追加 |
| `10 * user.level` 等のlevel参照箇所に `Math.max(1, user.level)` ガードを全箇所追加 |
| バトル結果overlayのOK時に `battleState.session` / `log` をクリアし前セッション残留を防止 |
| 訓練画面でペットパネルの「野に放つ」ボタンを非表示化し誤削除を防止 |
| `showReleaseConfirmDialog` の targets 空時にコンソール警告を追加 |
| 図鑑カウンターの `.screen-title` 不在時フォールバック挿入を追加 |
| 世代バッジ（2世以上）を金色（#FFD700）で表示（1世はバッジなし・仕様通り） |
| `startHungerTimer` 前に `renderStatusBar()` 呼び出し済みであることを確認（実装済み扱い） |
| `RARITY_THRESHOLDS` 閾値を実測分散値域ベースに引き上げ（伝説:6200 / 英雄:4800 / 希少:3400 / 高級:2500）。目標確率：伝説2%・英雄8%・希少20%・高級30%・一般40% |
| 訓練画面でMP=0かつスキル未発動の場合に「💤 スキル不発動（MP不足）」をログへ追記 |

---

## バグ修正履歴

| 修正内容 | 詳細 |
|---------|------|
| 庭パネルのステータス未更新 | タイマー発火時に `showPetPanel()` を再描画するよう修正 |
| ケージ給餌時スクロールリセット | `renderCage()` 全体再描画を `updateCageCard()` カード単位更新に変更 |
| レア度表示の統一 | 全画面で★数のみ表示（`rarity.split(' ')[0]`）に統一 |
| ナビゲーション全画面不到達 | `renderBattle()` 内で `canBlock` をdiffHTML生成後に定義していたため参照エラー発生→定義を `diffHTML` 生成前に移動して修正 |
| 給餌時 attack・defense が増加しない | `feedPet` の `allCapped` 判定が attack/defense の2ステのみだったため、hp/mp が未上限でも成長ブロックされていた → 4ステ全て上限の判定に修正（spec §1.5準拠） |
| 全ステ上限到達後の餌やりでHP回復が発動しない | spec §1.5 の仕様が未実装だった → `FEED_HP_RESTORE=20` 定数追加・`allCapped` 時に `fresh.hp` を回復するよう実装 |
| デコメニューに閉じるボタンがない | `#item-tray` ヘッダー右に×ボタンを追加・`closeItemTray()` をバインド。デコボタンの再タップ閉じ分岐は削除 |
| 訓練ペット選択でスクロールが左端にリセットされる | `overflow-x:auto` コンテナに `id="pet-select-scroll"` を付与し、クリックハンドラで `scrollLeft` を退避・復元するよう修正 |
