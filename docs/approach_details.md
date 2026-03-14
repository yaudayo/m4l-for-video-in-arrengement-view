# 各共有方式の詳細解説・遅延評価・maxpat 構造説明

> **対象ファイル:** `shared/approach1_named_matrix.js` 〜 `approach5_pattr.js`,  
> `devices/video_source/`, `devices/video_fx/`, `devices/video_hub/`

---

## 目次

1. [共通前提：Max for Live のメッセージスケジューリング](#1-共通前提maxメッセージスケジューリング)
2. [Approach 1 — Named Jitter Matrix (jit.shared)](#2-approach-1--named-jitter-matrix-jitshared)
3. [Approach 2 — send / receive メッセージパッシング](#3-approach-2--send--receive-メッセージパッシング)
4. [Approach 3 — Shared Dictionary (dict)](#4-approach-3--shared-dictionary-dict)
5. [Approach 4 — OSC (udpsend / udpreceive)](#5-approach-4--osc-udpsend--udpreceive)
6. [Approach 5 — pattr / autopattr パラメータシステム](#6-approach-5--pattr--autopattr-パラメータシステム)
7. [遅延まとめ比較表](#7-遅延まとめ比較表)
8. [maxpat 構造詳細：video_source.maxpat](#8-maxpat-構造詳細video_sourcemaxpat)
9. [maxpat 構造詳細：video_fx.maxpat](#9-maxpat-構造詳細video_fxmaxpat)
10. [maxpat 構造詳細：video_hub.maxpat](#10-maxpat-構造詳細video_hubmaxpat)

---

## 1. 共通前提：Max メッセージスケジューリング

Max/MSP（および M4L）の実行モデルを理解することが遅延評価の前提となります。

### 1-1. スケジューラとキュー

Max は内部に **2 本のキュー**を持っています。

| キュー | 優先度 | 典型的な使用例 |
|---|---|---|
| **High-priority scheduler** | 高（リアルタイム） | MIDI, オーディオコールバック, `metro` |
| **Low-priority queue** | 低（メインスレッド） | UI 更新, `print`, `dict`, `js` の一部 |

`send` / `receive` と `dict` の更新はメインスレッド（低優先度キュー）で処理されます。  
`jit.matrix` への書き込み・読み出しは Jitter スレッドで行われる場合があります。

### 1-2. オーディオバッファサイズとの関係

Live の I/O バッファサイズ（典型値: 128〜512 サンプル ＠ 48 kHz = 2.7〜10.7 ms）は
オーディオ処理の最小単位ですが、**映像情報の共有はオーディオコールバックとは別の
メインスレッド/Jitter スレッドで行われる**ため、バッファサイズに直接依存しません。  
ただし Approach 5（pattr/オートメーション）はオーディオレートで補間されるため、
オーディオバッファサイズが実効的な更新粒度の下限になります。

---

## 2. Approach 1 — Named Jitter Matrix (`jit.shared`)

### 2-1. 仕組みの詳細

#### Jitter 名前付きマトリクスの内部構造

Max の Jitter ランタイムは **グローバルな名前レジストリ**（ハッシュテーブル）を持ちます。  
`jit.matrix` オブジェクトに `@name` 属性を指定すると、そのオブジェクトは

1. レジストリに `name` キーで登録されたメモリブロックを検索する。
2. 存在すれば **そのポインタを参照**（共有）する。存在しなければ新たに確保して登録する。

これにより、同一プロセス内に存在する 2 つ以上の `jit.matrix @name <same>` は
**まったく同じメモリ領域を指す**ことになります。C 言語の `mmap` に近い仕組みです。

```
[video_source patch]                   [video_fx patch]
jit.matrix @name m4lv_X_matrix  ←──→  jit.matrix @name m4lv_X_matrix
     ↑                                        ↑
     └────────── 同一メモリブロック ───────────┘
                  (Jitter 名前レジストリ)
```

#### 書き込みの流れ（video_source 側）

1. `jit.qt.movie` がビデオファイルをデコードし、ARGB フレームを内部バッファに展開する。
2. `jit.qt.movie` の outlet bang → `jit.matrix @name m4lv_X_matrix` に接続。
3. `jit.matrix` オブジェクトは受け取ったマトリクスデータを名前付きメモリブロックに
   **直接書き込む**（システムメモリ間コピーなし、DMA に近い操作）。

#### 読み出しの流れ（video_fx / video_hub 側）

1. `video_source.js` の `outlet(0, matrixName)` が名前文字列を出力する。
2. 下流の `jit.matrix @name …` オブジェクトがこのメッセージを受け取って
   `name` 属性を更新し、同一メモリブロックへの参照を確立する。
3. `bang` を受け取ると現在の内容を読み出し（ゼロコピー参照渡し）、
   `jit.brcosa` などのFX オブジェクトへ渡す。

#### マトリクス仕様

```
jit.matrix 4 char 1920 1080
```

- `4` : チャンネル数 (ARGB)
- `char` : データ型（8bit 符号なし整数 / チャンネル）
- `1920 1080` : 解像度

フレーム 1 枚のメモリ量 = 4 × 1 byte × 1920 × 1080 = **約 8 MB**

FHD では 8 MB、4K では 32 MB のメモリブロックが共有されます。

### 2-2. 遅延の評価

| フェーズ | 遅延 | 説明 |
|---|---|---|
| デコード（jit.qt.movie） | 0.5〜5 ms | コーデック・解像度に依存。H.264 FHD では約 1〜3 ms |
| 名前付きマトリクスへの書き込み | 0.2〜2 ms | DMA-like; FHD ARGB ≈ 8 MB のメモリ書き込み |
| bang 通知（source→fx） | < 0.1 ms | Max メッセージ、同一スレッド内同期処理 |
| 読み出し（jit.brcosa 等） | 0.05〜0.5 ms | ポインタアクセスのみ、実質ゼロコピー |
| **合計（典型値）** | **1〜8 ms** | 30fps 予算 33.3 ms に対して十分余裕あり |

**遅延の主要因はデコーダ（jit.qt.movie）であり、共有・転送自体のオーバーヘッドはほぼゼロです。**

ProRes などの I フレームのみコーデックを使用すると、デコード時間を 0.5〜1 ms 程度まで
削減できます。

### 2-3. 注意点

- 名前付きマトリクスは Max プロセス（= M4L セッション）内でのみ共有可能。
  異なるコンピュータや異なる Live セッションには届きません。
- マトリクスのサイズ（解像度・チャンネル数・データ型）は作成時に決定します。
  既存の名前に異なるサイズで接続しようとすると、Jitter はサイズを強制するか
  既存サイズに合わせて切り詰めます。実運用では全デバイスで同一サイズを使うこと。

---

## 3. Approach 2 — send / receive メッセージパッシング

### 3-1. 仕組みの詳細

#### send / receive の内部構造

Max の `send` と `receive` はグローバルな **シンボルテーブル**（Symbol registry）を
共有します。`receive my_channel` を作成すると、ランタイムは `my_channel` という
シンボルに対応するリスナーリストにこのオブジェクトを登録します。

```
send m4lv_X_frame
  ↓  (Symbol lookup in global registry)
  ↓  (linear scan of all listeners for "m4lv_X_frame")
receive m4lv_X_frame (FX device)
receive m4lv_X_frame (Hub device)
```

`send` が発火すると、リスナーリストを順番に辿りメッセージをコピーして届けます。
この処理は**同期的**（呼び出し元スレッドでブロッキング実行）です。

#### このプロジェクトでの実装

```
[video_source.js] outlet(1, list)
    ↓
[send m4lv_<rackId>_frame]   ← .maxpat 内 obj-10
    ↓ (メッセージ配信)
[receive m4lv_<rackId>_frame]  ← video_fx.maxpat obj-3
    ↓
[video_fx.js] inlet 1 → function list()
    ↓ _parseFrameList(args) で 18 要素リストを解析
```

`VideoFrameInfo` はフラットリスト（18 要素）に直列化されます。  
フィールド順は `video_frame_info.js` の `toList()` で定義されており、全デバイスが
共通仕様に従っています。

```javascript
// shared/video_frame_info.js — toList() の返値
[trackId, clipId, playheadTime, clipStartTime, clipLength, localTime,
 filePath, frameRate, frameIndex, width, height, layer,
 tx, ty, scaleX, scaleY, rotation, opacity]   // 計 18 要素
```

#### メタデータのみの転送

Approach 2 はピクセルデータを含まず、**どのフレームを表示するかの指示**のみを運びます。
ピクセルデータは Approach 1 の名前付きマトリクス経由で別途共有されます。
この設計によりメッセージサイズを最小限に保ちつつ、FX デバイスが `filePath` や
`frameIndex` を読んで独自のファイルアクセスを行う拡張も可能です。

### 3-2. 遅延の評価

| フェーズ | 遅延 | 説明 |
|---|---|---|
| リスト生成 (js 内) | < 0.1 ms | JavaScript 配列アロケーション |
| outlet() → send | < 0.05 ms | Max C 関数呼び出し |
| シンボルルックアップ | < 0.01 ms | ハッシュテーブル O(1) |
| リスナーへのコピー | 0.01〜0.1 ms | 18 要素 × (N 受信者) の atom コピー |
| 受信側 list() 実行 | < 0.1 ms | arrayfromargs + フィールド出力 |
| **合計（典型値）** | **< 0.5 ms** | 受信者 2〜5 台でも 1 ms 未満 |

複数の FX デバイスが連鎖している場合、チェーン 1 段で約 0.1〜0.3 ms が加算されます。
5 段 FX チェーンでも **累積遅延 1〜2 ms** 程度です。

**send/receive の唯一の "遅延" になりやすいポイント**は、Max の低優先度キューに
詰まった他のメッセージが多い場合のキュー待ちです。セッションが重い場合は数 ms 単位の
ジッターが生じることがあります。この問題は Approach 1（高優先度 Jitter スレッド）には
起きません。

### 3-3. 注意点

- 同一チャンネル名を使うすべての `receive` がメッセージを受け取るため、
  複数ラックが同じ rackId を使うと意図しないクロストークが起きます。
  → `setRackId` でラック固有の名前を設定してください。
- 大量のリスナーが存在するとコピーのコストが線形に増加します（通常問題なし）。

---

## 4. Approach 3 — Shared Dictionary (`dict`)

### 4-1. 仕組みの詳細

#### Max dict の内部構造

`dict` オブジェクトは Max 7 以降で導入された **名前付きグローバル JSON ストア** です。  
内部は C++ の `std::unordered_map<string, atom>` に近い実装で、  
`set key value` メッセージでキーに値を書き込み、`get key` で読み出します。

JavaScript 側からは `new Dict(name)` でインスタンスを取得し、
`d.set(path, value)` / `d.get(path)` で操作します。

パス区切り文字 `/` を使うことで階層的なキーを表現できます:

```
"tracks/t1/filePath"         → { tracks: { t1: { filePath: "..." } } }
"tracks/t1/effects/blur/radius" → { tracks: { t1: { effects: { blur: { radius: 5 } } } } }
```

#### dict.view による変更通知

```
[dict.view m4lv_X_state]
    ↓ (bang: dict が変更されるたびに発火)
[video_fx.js] inlet 2 → function bang()
    ↓
_readLayersFromDict()  / _broadcast(frame)
```

`dict.view` は指定した dict を**ポーリングなし**で監視します。  
dict のいずれかのキーが変更されると次のメインスレッドのティックで bang を送出します。

#### このプロジェクトでの書き込みフロー

`video_source.js` の `_writeToDict()` が 1 フレームごとに実行されます:

```javascript
var d      = new Dict("m4lv_X_state");
var prefix = "tracks/" + trackId + "/";
d.set(prefix + "clipId",       currentClipId);      // key 1
d.set(prefix + "playheadTime", playingPosition);    // key 2
d.set(prefix + "clipStartTime", ...);               // key 3
// … 合計 11 キー書き込み
```

FX デバイスは処理後にエフェクトパラメータを同じ dict に追記します:

```javascript
// approach3_shared_dict.js — writeFxParam()
var prefix = "tracks/" + trackId + "/effects/" + fxName + "/";
d.set(prefix + key, value);
```

Hub は `"tracks/<id>/transform/opacity"` などを読んでレイヤー合成を行います。

#### pattrstorage との連携（将来拡張）

`pattrstorage` の `@dict` 属性で dict をプリセットとして保存・復元できます。
これにより Approach 3 のデータを Live Set に永続化することが可能になります。

### 4-2. 遅延の評価

| フェーズ | 遅延 | 説明 |
|---|---|---|
| `new Dict(name)` (js 内) | 0.01〜0.05 ms | 名前テーブルルックアップ |
| `d.set()` × 11 キー | 0.1〜0.5 ms | ハッシュ挿入 × 11 回 |
| dict.view 発火（バウンド）| 0.1〜1 ms | メインスレッドの次ティックまで待機 |
| FX 側 `d.get()` × 18 キー | 0.2〜1 ms | ハッシュ参照 × 18 回 |
| **合計（典型値）** | **0.5〜3 ms** | キー数・セッション負荷に依存 |

dict.view の「次ティックまで待機」が実質的なレイテンシの主要因です。  
Max のスケジューラが混雑している場合は 2〜5 ms のジッターが生じることがあります。

**ピクセル操作**（フレームごとの全ピクセル書き換え）には向かないため、
ピクセルデータは Approach 1 で共有し、Approach 3 はメタデータ・エフェクトパラメータ
専用として使用することを推奨します。

### 4-3. 注意点

- dict はセッショングローバルなため、プロジェクトをまたぐ名前衝突に注意してください。
  rackId をプレフィックスとして使う規約（`m4lv_<rackId>_state`）で衝突を防ぎます。
- `dict.view` は値が変化しなくても「書き込み」があれば bang を送出します。
  `d.set()` を呼ぶたびに FX が再実行されるため、変化があった場合のみ書き込む
  最適化（前回値との比較）を将来的に検討してください。

---

## 5. Approach 4 — OSC (`udpsend` / `udpreceive`)

### 5-1. 仕組みの詳細

#### UDP ループバックの動作

```
[js approach4_osc.js]
    ↓ outlet(0, ["/m4lv/X/frame", trackId, clipId, ...])
[udpsend 127.0.0.1 9000]
    ↓ カーネル → ループバックインターフェース → 受信バッファ
[udpreceive 9000]
    ↓ Max メッセージとして復元
[js approach4_osc.js] inlet 1 → function list()
```

`udpsend` はメッセージリストを **OSC バイナリ形式**に直列化してから UDP パケットとして
送出します。Max の OSC 実装はアドレス文字列と型タグを 4 バイト境界にパッドします。

18 フィールド（文字列 4 個 + 数値 14 個）の典型的なパケットサイズ:

| セクション | サイズ |
|---|---|
| OSC アドレス `/m4lv/X/frame\0` + パッド | 20〜28 bytes |
| 型タグ文字列 `,sssfffffffiffsfffff\0` + パッド | 24 bytes |
| 引数（文字列 × 3 + 数値 × 15） | 60〜300 bytes（パス長依存）|
| **合計** | **~150〜400 bytes** |

127.0.0.1 (ループバック) ではパケットは実際のネットワークハードウェアを経由せず、
OS のネットワークスタック内部で折り返されます。

#### OSC アドレスパターン

`approach4_osc.js` が定義する 3 種のアドレス:

| アドレス | 用途 | 引数 |
|---|---|---|
| `/m4lv/<rackId>/frame` | フレームメタデータ | trackId, clipId, 時刻, filePath, 寸法, 変換 (計 18) |
| `/m4lv/<rackId>/fx` | FX パラメータ更新 | trackId, fxName, key, value |
| `/m4lv/<rackId>/layer` | レイヤー順序変更 | srcTrackId, layerIndex |

受信側の `list()` 関数は `args[0]`（OSC アドレス文字列）を `indexOf` で判別し、
該当パターンのフィールドを outlet に出力します。

#### ポート番号の割り当て

`approach4_osc.js` の `_computePort()`:

```javascript
function _computePort(id) {
    var n = parseInt(id, 10);
    return isNaN(n) ? 9000 : 9000 + (n % 1000);
}
```

rackId が数値の場合 `9000 + (rackId % 1000)` で 9000〜9999 の範囲に収めます。
最大 1000 ラックが衝突なしに共存できます。

### 5-2. 遅延の評価

| フェーズ | 遅延 | 説明 |
|---|---|---|
| OSC メッセージ生成（js 配列）| < 0.1 ms | 配列アロケーション |
| udpsend シリアライズ | 0.1〜0.3 ms | OSC バイナリエンコーディング |
| UDP ループバック（カーネル往復）| 0.05〜0.5 ms | macOS/Linux ループバック実測値 |
| udpreceive デシリアライズ | 0.1〜0.3 ms | OSC バイナリデコーディング |
| list() 実行（受信側 js）| < 0.1 ms | |
| **合計（典型値）** | **0.4〜1.5 ms** | |

UDP の特性上、パケットロスが起きる可能性があります（ループバックでは実際には
ほぼゼロですが、システム負荷が高い場合は稀に発生します）。
映像フレームは 1/30 秒ごとに更新されるため、1 パケット欠損しても次フレームで
自動的に追い付きます。

**外部アプリケーション（TouchDesigner, Resolume, vvvv 等）との連携**が主な用途です。
同一 Max セッション内のみで完結する場合は Approach 1〜3 の方が低遅延です。

### 5-3. 注意点

- macOS の App Sandbox 環境では UDP ソケットの使用に `com.apple.security.network.client`
  権限が必要です。M4L 環境（Live 内 Max）では通常問題なし。
- 外部アプリからポートが既に使用されている場合、`udpreceive` のバインドに失敗します。
  ポート競合が発生したら `setPort` メッセージで別ポートに変更してください。
- ピクセルデータは OSC で転送しません（帯域幅・レイテンシの観点から非現実的）。
  ピクセルは Approach 1、メタデータを Approach 4 という組み合わせを推奨します。

---

## 6. Approach 5 — `pattr` / `autopattr` パラメータシステム

### 6-1. 仕組みの詳細

#### pattr システムの概要

`pattr`（parameter attribute）は Max 4 以降で使用できるパッチ内パラメータ管理の
仕組みです。各 `pattr` オブジェクトは名前と現在値を持ち、以下の機能を提供します:

- **永続化**: `pattrstorage` が現在の全 pattr 値をプリセットとして保存・復元する
- **Live オートメーション**: `live.parameter~` / `live.dial` 等の UI オブジェクトと
  連動し、Ableton のオートメーションレーンから値を制御できる
- **変更通知**: 値が変わると登録されたリスナーに通知が飛ぶ

#### このプロジェクトでの使用方法

```
[live.dial @varname opacity]    ← UI ダイアル（オートメーション可）
    ↓ (autopattr が自動登録)
[autopattr]
    ↓
[pattrstorage m4lv_X_params @greedy 1 @autoread 1 @autosave 1]
    ↓ (値変化通知)
[js approach5_pattr.js] inlet 1 → _handleParamChange()
    ↓ outlet(0, "opacity", 0.8)
```

`autopattr` は同じパッチ内のすべての名前付き UI オブジェクト（`@varname` 属性を持つ
`live.dial`, `live.text` 等）を自動的にスキャンして pattr 化します。

`pattrstorage @autoread 1 @autosave 1` の効果:

| 属性 | 効果 |
|---|---|
| `@autoread 1` | パッチロード時にプリセットを自動読み込み |
| `@autosave 1` | パッチアンロード時にプリセットを自動保存 |
| `@greedy 1` | 子パッチの pattr も再帰的に管理下に置く |

#### 管理パラメータ一覧（PARAM_DEFS）

`approach5_pattr.js` で定義される 9 個の Live オートメーション対応パラメータ:

| パラメータ名 | デフォルト | 範囲 | 単位 | 用途 |
|---|---|---|---|---|
| `opacity` | 1.0 | 0.0〜1.0 | — | レイヤー不透明度 |
| `scaleX` | 1.0 | 0.1〜4.0 | — | 水平スケール |
| `scaleY` | 1.0 | 0.1〜4.0 | — | 垂直スケール |
| `posX` | 0.0 | −1920〜1920 | px | 水平位置 |
| `posY` | 0.0 | −1080〜1080 | px | 垂直位置 |
| `rotation` | 0.0 | −180〜180 | deg | 回転角 |
| `layer` | 0 | 0〜127 | — | Z 順インデックス |
| `blendMode` | 0 | 0〜7 | — | ブレンドモード選択 |
| `timeOffset` | 0.0 | −10〜10 | s | 時間軸オフセット |

### 6-2. 遅延の評価

| フェーズ | 遅延 | 説明 |
|---|---|---|
| pattr 通知（値変化 → js）| 0.01〜0.1 ms | 同プロセス内、ほぼ即時 |
| Live オートメーション補間 | 1 バッファ分 | 典型 2.7〜10.7 ms @ 48kHz |
| `dumpAll()` 全値出力 | 0.05〜0.2 ms | 9 パラメータ × outlet() |
| pattrstorage 自動保存 | 1〜10 ms | ファイル I/O（Close 時のみ） |
| **オートメーション制御の実効遅延** | **3〜12 ms** | オーディオバッファサイズ依存 |

pattr 自体の通知は非常に高速ですが、Live のオートメーションは**オーディオエンジンの
バッファ境界**で補間・更新されます。そのため、`opacity` をオートメーションで
フェードさせる場合、最小の変化粒度はオーディオバッファサイズ（約 2.7〜10.7 ms）になります。
映像用途ではフレーム間の変化として目立たないため実用上は問題ありません。

### 6-3. 注意点

- pattr はスカラー値（単一の数値・文字列）のみ管理できます。
  ファイルパスや複雑なデータ構造は `dict`（Approach 3）を使ってください。
- `pattrstorage` の名前が Live Set をまたいで衝突すると、別セットのパラメータが
  誤って読み込まれます。`m4lv_<rackId>_params` という命名規則を厳守してください。
- `getParamDefs()` を `loadbang` 時に呼ぶことで、デバイスがロードされた時点で
  すべてのパラメータのデフォルト値を UI に反映できます。

---

## 7. 遅延まとめ比較表

### 7-1. 定量比較

| | Approach 1 Named Matrix | Approach 2 send/receive | Approach 3 dict | Approach 4 OSC | Approach 5 pattr |
|---|---|---|---|---|---|
| **典型遅延** | 1〜8 ms | < 0.5 ms | 0.5〜3 ms | 0.4〜1.5 ms | 0.01〜0.1 ms* |
| **ピクセル転送** | ゼロコピー | ❌ | ❌ | ❌ | ❌ |
| **遅延主要因** | デコード | キュー待ち | dict.view バウンド | UDP RTT | オーディオバッファ* |
| **ジッター（揺らぎ）** | 低（Jitter スレッド） | 低〜中 | 中（スケジューラ依存）| 低〜中 | 低 |
| **30fps（33.3ms）で問題なし** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **60fps（16.7ms）で問題なし** | ✅（ProRes 推奨） | ✅ | ✅ | ✅ | ✅ |
| **外部アプリ連携** | ❌ | ❌ | ❌ | ✅ | ❌ |

*pattr の 0.01〜0.1 ms はコード間通知のみ。Live オートメーション経由では 3〜12 ms。

### 7-2. 組み合わせの推奨

```
ピクセルデータ    →  Approach 1（Named Matrix、ゼロコピー）
フレームメタデータ →  Approach 2（send/receive、軽量・即時）
エフェクト設定保存 →  Approach 3（dict、構造化・永続化）
外部ツール連携    →  Approach 4（OSC）
オートメーション  →  Approach 5（pattr）
```

実際には **Approach 1 + Approach 2 + Approach 5** の 3 本が核となる構成で、
外部ツールが必要なら Approach 4、設定の永続化が必要なら Approach 3 を追加します。

---

## 8. maxpat 構造詳細：`video_source.maxpat`

`devices/video_source/video_source.maxpat` の JSON 構造を読み解きます。

### 8-1. オブジェクト一覧

| ID | クラス / テキスト | 役割 |
|---|---|---|
| `obj-1` | `live.thisdevice` | M4L デバイス固有のコンテキスト情報を提供。`device_id`, `track_id` 等を outlet から出力。パッチロード時に自動的に bang を発火。 |
| `obj-2` | `js video_source.js` | メインロジック。5 種の共有 Approach をすべて実装。 |
| `obj-3` | `live.observer` | Live API オブザーバー。`playing_position` を監視し、再生ヘッドが動くたびに float を出力。 |
| `obj-4` | `jit.qt.movie` | ビデオファイルのデコーダ。QuickTime/AVFoundation ベース。読み込んだファイルを frame-by-frame に展開。 |
| `obj-5` | `jit.matrix 4 char 1920 1080 @name m4lv_default_matrix` | Approach 1 の名前付き共有マトリクス。`jit.qt.movie` の出力フレームを受け取りメモリに書き込む。 |
| `obj-6` | `message "setRackId $1"` | `$1` に代入された値を `setRackId <value>` というメッセージに変換。 |
| `obj-7` | `route device_id` | `live.thisdevice` からの `device_id <id>` メッセージのルーティング。`device_id` プレフィックスを取り除き ID 値のみを渡す。 |
| `obj-8` | `live.text @varname videoFilePath` | 動画ファイルパスの UI テキスト入力。`@parameter_enable 1` で Live オートメーション可能（Live 12+）。 |
| `obj-9` | `prepend setFilePath` | テキスト入力値に `setFilePath` プレフィックスを付加して `js` オブジェクトへ渡す。 |
| `obj-10` | `send m4lv_default_frame` | Approach 2 の送信端。`video_source.js` が出力する 18 要素リストを全受信者に配信。 |
| `obj-11` | `udpsend 127.0.0.1 9000` | Approach 4 の UDP 送信端。OSC フォーマットでループバックポートへ送出。 |
| `obj-12` | `print video_source` | デバッグ用。Max コンソールにステータス文字列を出力。 |

### 8-2. ワイヤリング図

```
[live.thisdevice]
    |  outlet 0 (device_id <id>, track_id <id>, …)
[route device_id]
    |  outlet 0 (id のみ)
[message "setRackId $1"]
    |  outlet (setRackId <id>)
    ↓
[js video_source.js]  ←── inlet 0 (制御メッセージ)
    ↑
[live.observer]
    |  outlet 0 (playing_position float)
    ↓ inlet 1 (再生位置、毎フレーム更新)

[live.text @varname videoFilePath]
    |  outlet (パス文字列)
[prepend setFilePath]
    |  outlet (setFilePath <パス>)
    ↓ inlet 0

[js video_source.js]
  outlet 0 (matrix name) ─────────────────→ [jit.matrix @name m4lv_default_matrix]
  outlet 1 (frame list) ──────────────────→ [send m4lv_default_frame]      (Approach 2)
  outlet 3 (OSC list) ────────────────────→ [udpsend 127.0.0.1 9000]       (Approach 4)
  outlet 5 (status string) ───────────────→ [print video_source]

[jit.qt.movie]
  outlet 0 (decoded frame matrix) ────────→ [jit.matrix @name …]  (Approach 1 書き込み)
```

### 8-3. 初期化シーケンス

パッチが M4L デバイスとして Live にロードされると以下の順で初期化されます:

1. **`live.thisdevice` が bang を発火** → `device_id <N>` メッセージを出力
2. **`route device_id` でフィルタ** → `N` だけが通過
3. **`message "setRackId $1"`** → `setRackId N` に変換
4. **`video_source.js` の `setRackId(N)`** が呼ばれ、  
   - `_matrixName = "m4lv_N_matrix"` を設定  
   - `_channel = "m4lv_N_frame"` を設定  
   - `_dictName = "m4lv_N_state"` を設定  
5. **`live.observer` が `playing_position` のリッスンを開始**
6. 以後、再生ヘッドが動くたびに `msg_float()` が呼ばれ `_broadcast()` が実行される

### 8-4. `classnamespace` の意味

```json
"classnamespace": "dsp.gen"
```

この属性は Max 8 の Gen~ DSP パッチとの互換モードを示しますが、M4L デバイスとして
動作する上では `"box"` でも問題ありません。実際には `dsp.gen` を指定していても
Jitter オブジェクトや `js` を含む通常のパッチとして機能します。
（将来的に Gen~ で DSP と映像を統合する場合の拡張ポイントとして残しています。）

---

## 9. maxpat 構造詳細：`video_fx.maxpat`

`devices/video_fx/video_fx.maxpat` の構造を解説します。

### 9-1. オブジェクト一覧

| ID | クラス / テキスト | 役割 |
|---|---|---|
| `obj-1` | `live.thisdevice` | ラック内での自デバイスの ID を取得。FX もラック ID を source と共有する。 |
| `obj-2` | `js video_fx.js` | FX 処理ロジック。エフェクトの適用と 5 Approach への再送出。 |
| `obj-3` | `receive m4lv_default_frame` | Approach 2 受信。source（または上流 FX）の send から frame 情報を受け取る。 |
| `obj-4` | `udpreceive 9000` | Approach 4 受信。UDP ループバックから OSC フレーム情報を受け取る。 |
| `obj-5` | `jit.matrix 4 char 1920 1080 @name m4lv_default_matrix` | Approach 1 入力。source が書き込んだ名前付きマトリクスを参照（ゼロコピー読み出し）。 |
| `obj-6` | `jit.brcosa` | Brightness / Contrast / Saturation FX。inlet 1 に値を送ると各パラメータを設定。 |
| `obj-7` | `jit.fastblur` | Gaussian ブラー FX。半径を inlet 1 で設定。 |
| `obj-8` | `jit.chromakey` | クロマキー FX。キーカラーと許容範囲を inlet で設定。 |
| `obj-9` | `jit.rota` | 回転・スケール変換。`@reset 0` で累積変換が可能。 |
| `obj-10` | `jit.matrix 4 char 1920 1080 @name m4lv_default_matrix_fx` | Approach 1 出力。FX 処理後のフレームを書き込む（hub が参照する）。 |
| `obj-11` | `send m4lv_default_frame` | Approach 2 出力。変更後の frame 情報を下流（次の FX または Hub）に送出。 |
| `obj-12` | `udpsend 127.0.0.1 9000` | Approach 4 出力。変更後の OSC フレーム情報を送出。 |
| `obj-13` | `dict.view m4lv_default_state` | Approach 3 の変更通知受信。dict が更新されると bang が来る。 |
| `obj-14` | `print video_fx` | デバッグ出力。 |
| `obj-15` | `live.dial @parameter_longname Brightness @varname brightness` | Brightness パラメータの UI。Live オートメーション対応。 |
| `obj-16` | `live.dial @parameter_longname Opacity @varname opacity` | Opacity パラメータの UI。Live オートメーション対応。 |

### 9-2. ワイヤリング図

```
[live.thisdevice] ──────────────────→ [js video_fx.js] inlet 0

[receive m4lv_default_frame] ───────→ [js video_fx.js] inlet 1  (Approach 2 受信)
[udpreceive 9000] ──────────────────→ [js video_fx.js] inlet 3  (Approach 4 受信)
[dict.view m4lv_default_state] ─────→ [js video_fx.js] inlet 2  (Approach 3 通知)

[js video_fx.js] outlet 0 (matrix name)
    ↓
[jit.matrix @name m4lv_default_matrix]  ← source のフレームを参照
    ├──→ [jit.brcosa]  → [jit.matrix @name m4lv_default_matrix_fx]  (Approach 1 出力)
    ├──→ [jit.fastblur]
    ├──→ [jit.chromakey]
    └──→ [jit.rota]

[js video_fx.js] outlet 1 (modified list) → [send m4lv_default_frame]  (Approach 2 出力)
[js video_fx.js] outlet 3 (OSC list)      → [udpsend 127.0.0.1 9000]   (Approach 4 出力)
[js video_fx.js] outlet 5 (status)        → [print video_fx]

[live.dial brightness] ─────────────→ [jit.brcosa] inlet 1 (brightness 値)
[live.dial opacity]    ─────────────→ [js video_fx.js] inlet 0 (setParam opacity …)
```

### 9-3. Jitter FX オブジェクトの接続設計

4 つの Jitter FX（`jit.brcosa`, `jit.fastblur`, `jit.chromakey`, `jit.rota`）は
入力マトリクス（`obj-5`）から**並列に分岐**して受け取ります。
実際に使用するのは一度に 1 つのエフェクトタイプですが、この設計により実行時に
パッチを変更することなくエフェクトタイプを切り替えられます。

`video_fx.js` の `effectType` 変数でアクティブなエフェクトを管理し、
`_broadcast()` 内でエフェクトの種類を判断して適切な Jitter オブジェクトへの
パラメータ送出を行います。

```javascript
// video_fx.js — _applyEffect() の一部
switch (effectType) {
    case "opacity":
        frame.op = Math.max(0, Math.min(1, frame.op * effectParams.opacity));
        break;
    case "zoom":
        frame.sx *= effectParams.zoom;
        frame.sy *= effectParams.zoom;
        break;
    // …
}
```

ピクセルレベルの変換（brightness, blur, chroma_key）は dict にパラメータを書き込み、
Hub が Jitter オブジェクトをドライブする方式を採っています。
これにより FX チェーンが長くなっても実際のピクセル処理は Hub 側でまとめて行えます。

---

## 10. maxpat 構造詳細：`video_hub.maxpat`

`devices/video_hub/video_hub.maxpat` の構造を解説します。

### 10-1. オブジェクト一覧

| ID | クラス / テキスト | 役割 |
|---|---|---|
| `obj-1` | `live.thisdevice` | Hub 自身のデバイス ID 取得。グループ/マスタートラック上のデバイス ID をラック ID として使用。 |
| `obj-2` | `js video_hub.js` | レイヤー管理・合成制御ロジック。子トラックの登録・解除・Z ソート・合成指示。 |
| `obj-3` | `receive m4lv_default_frame` | Approach 2 受信。子トラックの FX チェーン末尾からの frame 情報を集約。 |
| `obj-4` | `udpreceive 9000` | Approach 4 受信。外部アプリからの合成指示も受け付ける。 |
| `obj-5` | `dict.view m4lv_default_state` | Approach 3 受信。子トラックの dict 書き込みを監視。 |
| `obj-6` | `jit.matrix 4 char 1920 1080 @name m4lv_default_matrix` | レイヤー 1 入力。source/FX が書き込んだ原フレームを参照。 |
| `obj-7` | `jit.matrix 4 char 1920 1080 @name m4lv_default_matrix_fx` | レイヤー 2 入力。FX 処理後フレームを参照。 |
| `obj-8` | `jit.op @op sfade` | Alpha-over アルゴリズムで 2 レイヤーを合成。inlet 0 = 背面, inlet 1 = 前面, outlet = 合成結果。 |
| `obj-9` | `jit.matrix 4 char 1920 1080 @name m4lv_default_hub_output` | 合成結果の名前付き出力マトリクス。親 Hub や出力デバイスが参照できる。 |
| `obj-10` | `send m4lv_default_frame` | Approach 2 出力。合成されたメタデータを親 Hub に送出。 |
| `obj-11` | `udpsend 127.0.0.1 9000` | Approach 4 出力。外部アプリへの合成完了通知。 |
| `obj-12` | `jit.window Video Hub Output @floating 1` | リアルタイムプレビューウィンドウ。`@floating 1` で常時最前面表示。 |
| `obj-13` | `print video_hub` | デバッグ出力。 |
| `obj-14` | `live.dial @parameter_longname Layer_1_Opacity @varname layer1_opacity` | レイヤー 1 不透明度 UI（Live オートメーション対応）。 |
| `obj-15` | `live.dial @parameter_longname Layer_2_Opacity @varname layer2_opacity` | レイヤー 2 不透明度 UI（Live オートメーション対応）。 |

### 10-2. ワイヤリング図

```
[live.thisdevice] ────────────────────→ [js video_hub.js] inlet 0

[receive m4lv_default_frame] ─────────→ [js video_hub.js] inlet 1  (Approach 2)
[udpreceive 9000] ────────────────────→ [js video_hub.js] inlet 3  (Approach 4)
[dict.view m4lv_default_state] ───────→ [js video_hub.js] inlet 2  (Approach 3)

──── Approach 1 合成パイプライン ────

[jit.matrix @name m4lv_default_matrix]    (レイヤー 1 = source フレーム)
    ↓ outlet 0
[jit.op @op sfade] inlet 0

[jit.matrix @name m4lv_default_matrix_fx] (レイヤー 2 = FX フレーム)
    ↓ outlet 0
[jit.op @op sfade] inlet 1

[jit.op @op sfade] outlet 0
    ↓
[jit.matrix @name m4lv_default_hub_output] (合成出力マトリクス)
    ↓
[jit.window Video Hub Output @floating 1]  (プレビュー表示)

──── Approach 2, 4 出力 ────

[js video_hub.js] outlet 1 → [send m4lv_default_frame]  (親 Hub へ)
[js video_hub.js] outlet 3 → [udpsend 127.0.0.1 9000]   (外部アプリへ)
[js video_hub.js] outlet 5 → [print video_hub]

──── pattr 入力 ────

[live.dial layer1_opacity] → [js video_hub.js] inlet 0 (setParam …)
[live.dial layer2_opacity] → [js video_hub.js] inlet 0
```

### 10-3. `jit.op @op sfade` — Alpha-over アルゴリズム

`sfade`（software fade）は Jitter の組み込みブレンドモードで、
**Porter-Duff "over" アルゴリズム**を実装しています:

```
出力[ARGB] = 前面[ARGB] × α前面 + 背面[ARGB] × (1 - α前面)
```

`obj-8` の inlet 0 に背面レイヤー（`m4lv_default_matrix`）、  
inlet 1 に前面レイヤー（`m4lv_default_matrix_fx`）を接続することで、  
FX 処理後のレイヤーが元フレームの上に重なります。

3 レイヤー以上を合成する場合は `jit.op @op sfade` を複数段に連結します:

```
layer_0 ─┐
          [jit.op sfade] → temp_01 ─┐
layer_1 ─┘                          [jit.op sfade] → output
                         layer_2 ───┘
```

`video_hub.js` の `_sortedLayers()` が Z インデックスでソートしたレイヤーリストを
返し、`.maxpat` 側の合成パイプラインへ順番に送り込む設計です。

### 10-4. Hub の階層構造（グループ → マスター）

グループトラックの Hub が出力する `m4lv_<groupRackId>_hub_output` は、
マスタートラックの Hub が `addTrack` メッセージで登録することで参照できます:

```
グループ Hub          マスター Hub
  ↓ hub_output ────→ addTrack groupId 0
                      ↓ 読み込み m4lv_groupId_hub_output
                      ↓ jit.op sfade
                      ↓ m4lv_masterRackId_hub_output
                      ↓ jit.window (最終出力)
```

このネスト構造により、任意の深さのグループ階層をサポートできます。

---

## 付録：方式選択フローチャート

```
ピクセルデータが必要か？
  Yes →  Approach 1 (Named Matrix)
  No  →
    外部アプリと連携するか？
      Yes → Approach 4 (OSC)
      No  →
        Live オートメーションが必要か？
          Yes → Approach 5 (pattr) + Approach 2 または 3
          No  →
            データを永続化・構造化したいか？
              Yes → Approach 3 (dict)
              No  → Approach 2 (send/receive)
```

実際のデプロイでは上記の組み合わせを重ねて使うことがほとんどです。
最小構成は **Approach 1 + Approach 2**（ピクセル + メタデータ）で、
そこに必要に応じて Approach 3〜5 を追加します。

---

## 付録 B：CPU マトリクス vs GPU テクスチャ

上記の Approach 1〜5 はいずれも CPU 側の `jit.matrix` を基盤としています。
パフォーマンスを最大化するためには、動画フレームを**GPU テクスチャ（`jit.gl.texture`）**
として扱う「GPU パス」への移行が有効です。

- `jit.gl.texture` による名前共有（Approach 1 の GPU 版）
- `jit.gl.pix` + GLSL シェーダによる FX（Approach 1 の CPU FX 群を置換）
- `jit.gl.render` による GPU マルチレイヤー合成
- CPU パスと GPU パスの使い分け基準
- このプロジェクトへの段階的な移行手順

詳細は **[docs/gpu_texture_path.md](./gpu_texture_path.md)** を参照してください。
