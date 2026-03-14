# パッチャー抽象化による設計 — 可能・不可能の評価と最小インターフェース設計

> **この文書が答える問い:**
>
> - 動画情報共有をパッチャー（Max アブストラクション）で扱うことは可能か？
> - OSC で動画情報を出力するデバイスをどう設計するか？
> - FX デバイスを簡単に作れる共有パッチャーはどう設計するか？
> - デバイス間で送受信する情報の最小化はどこまで可能か？

---

## 目次

1. [前提：動画はテクスチャ状態](#1-前提動画はテクスチャ状態)
2. [可能・不可能の評価](#2-可能不可能の評価)
3. [最小「動画信号」の定義](#3-最小動画信号の定義)
4. [共有パッチャー抽象化 `m4lv.frame_io`](#4-共有パッチャー抽象化-m4lvframe_io)
5. [OSC 出力デバイスの設計](#5-osc-出力デバイスの設計)
6. [FX デバイスの設計](#6-fx-デバイスの設計)
7. [デバイス作成の最小手順](#7-デバイス作成の最小手順)
8. [ラック ID の自動取得](#8-ラック-id-の自動取得)
9. [まとめ — 実装方針の推奨](#9-まとめ--実装方針の推奨)

---

## 1. 前提：動画はテクスチャ状態

前セッションで確立した通り、動画フレームは **GPU テクスチャ（`jit.gl.texture @name X`）**
として扱うのが基本です（詳細: [gpu_texture_path.md](./gpu_texture_path.md)）。

これが設計を大幅に簡略化します：

- テクスチャは **名前（文字列）で参照** できる
- 同名テクスチャは Max セッション内でゼロコピー共有される
- つまり **「動画を渡す」= 「テクスチャ名を渡す」** だけでよい

→ **デバイス間で送る情報 = テクスチャ名（文字列1個）＋αの数値**

---

## 2. 可能・不可能の評価

### ✅ 可能なこと

| 目標 | 手段 | 備考 |
|---|---|---|
| 動画情報共有をパッチャーで完全に隠蔽する | Max アブストラクション（`.maxpat`を名前で呼び出す） | `[m4lv.frame_io]` と書くだけで使える |
| FX デバイスを JS コードなしで作れる | アブストラクション内部に必要なロジックをすべて格納 | FX 作者はシェーダだけ書けばよい |
| デバイス間の情報を最小化する | テクスチャ名 1 個 + frameIndex 1 個 + layer 1 個（計 3 値） | 詳細は§3 |
| OSC でフレームメタデータを外部出力する | `udpsend` / `udpreceive` ＋ `OSC-format` | テクスチャ本体は送れないが frameIndex は送れる |
| GPU テクスチャを FX デバイスで加工する | `jit.gl.pix @file shader.jxs` — コード不要 | シェーダの `.jxs` ファイルだけが必要 |
| レンダリングをハブで 1 パス合成する | `jit.gl.render @name ctx` ＋ `jit.gl.videoplane` | コード不要、属性設定のみ |
| Live パラメータとの連動 | `live.dial` / `pattr` をアブストラクション内に入れる | オートメーション対応も含む |

### ❌ 不可能なこと / 制限

| 目標 | 理由 | 代替 |
|---|---|---|
| GPU テクスチャ本体を OSC 送信 | OSC は UDP バイト列のみ。VRAM データは送れない | frameIndex + テクスチャ名を送り、受信側で同名テクスチャを参照 |
| JS ゼロでラック ID を自動取得 | `live.thisdevice` の id 出力を文字列化するには最小限の変換が必要 | アブストラクション内に 1 箇所だけ `[sprintf m4lv_%d_]` パターンで隠蔽可 |
| 複数ラックを同一 OSC ポートで区別 | ポートは 1 本 1 チャンネル | OSC アドレスにラック ID を含める `/m4lv/<rackId>/frame` |
| テクスチャを別 PC へリアルタイム転送 | ネットワーク帯域の問題（FHD 30fps = 〜240 MB/s） | Syphon/NDI のみ対応可（別途実装）|

---

## 3. 最小「動画信号」の定義

### インターフェース（デバイス間で流れる情報）

```
┌──────────────────────────────────────────────────────┐
│  動画信号 (Video Signal) — デバイス間プロトコル        │
│                                                      │
│  値1: texName  (symbol)  "m4lv_42_tex_t1"           │
│  値2: frameIdx (int)      750                        │
│  値3: layer    (int)      0                          │
│                                                      │
│  合計: 1 symbol + 2 int = 3 値のみ                   │
└──────────────────────────────────────────────────────┘
```

### 各フィールドの役割

| フィールド | 型 | 意味 | FX デバイスでの使い方 |
|---|---|---|---|
| `texName` | symbol | GPU テクスチャ名。これを `jit.gl.videoplane @texture` に渡すだけで映像が出る | 受け取って shader に流す。加工後に別名テクスチャとして出力 |
| `frameIdx` | int | 現在のフレーム番号。タイムシフト FX でのみ使う | 加算・減算して出力。普通の FX はスルーするだけ |
| `layer` | int | Z 順。Hub での合成順序 | 通常はスルー。Layer FX の場合だけ変える |

### なぜ `filePath`・`clipId`・`playheadTime` を除外するか

- それらは `video_source` が内部で計算済みで、下流デバイスは **不要**
- テクスチャ名さえあれば、下流は「どのファイルか」を知る必要がない
- OSC 出力デバイスだけが `frameIdx` を使って外部同期に使う

---

## 4. 共有パッチャー抽象化 `m4lv.frame_io`

### 概要

FX デバイスと OSC デバイスが共通して使う **Max アブストラクション**。

ファイル名: `m4lv.frame_io.maxpat`（このファイル 1 つを Max の Search Path に置くだけ）

### インレット / アウトレット

```
      [m4lv.frame_io]
         │     │     │
       in0   in1   in2
     texName frame layer
         │     │     │
    ┌────┴─────┴─────┴────┐
    │   m4lv.frame_io     │
    │  ・テクスチャ名を    │
    │    受け取り保持      │
    │  ・send/receive で  │
    │    下流へ転送        │
    │  ・ラックIDは自動    │
    └────┬─────┬─────┬────┘
         │     │     │
       out0  out1  out2
     texName frame layer
```

| ポート | 型 | 方向 | 説明 |
|---|---|---|---|
| in 0 / out 0 | symbol | 双方向 | テクスチャ名 |
| in 1 / out 1 | int | 双方向 | フレーム番号 |
| in 2 / out 2 | int | 双方向 | レイヤー番号 |

### アブストラクション内部の構造（疑似図）

```
[live.thisdevice]
      │ id
[sprintf m4lv_%d_frame]  ← ラックID から send/receive チャンネル名を作る
      │ "m4lv_42_frame"
      ▼
[s— (send)]          [r— (receive)]
      ↑                      │
in0,1,2 ─── pack ───→ send   receive ─── unpack ──→ out0,1,2
```

ポイント：
- JS コード不要。`sprintf` ＋ `pack` ＋ `unpack` ＋ `send` ＋ `receive` だけ
- ラック ID の取得は `live.thisdevice` → `sprintf` 1 段で完結
- FX デバイス作者はこのアブストラクションの**インレット/アウトレットだけを使えばよい**

### アブストラクション入手・配置方法

1. `m4lv.frame_io.maxpat` を `~/Documents/Max 8/Max for Live Devices/` または
   Max の **File Preferences > Search Path** に追加
2. 各デバイスの `.maxpat` 内で `[m4lv.frame_io]` と記述するだけで使える

---

## 5. OSC 出力デバイスの設計

### 目的

- `video_source` が計算したフレーム情報を **UDP/OSC** で外部アプリ（TouchDesigner, Resolume, QLab 等）へ送信
- テクスチャ本体（ピクセルデータ）は送れないので **メタデータのみ** を送る
- 受信側は同じ frameIdx を元に自分でビデオファイルを再生・同期する

### OSC メッセージ（最小）

```
/m4lv/<rackId>/frame  frameIdx  layer
               例:  /m4lv/42/frame  750  0
```

たった 2 個の数値。受信側はこの frameIdx を使って：
- 自分のビデオプレイヤーをシーク（VLC, jit.qt.movie など）
- または LTC/MTC タイムコード変換

### デバイス構造（パッチャーのみ、JS なし）

```
[m4lv.frame_io]           ← 共有アブストラクション
    │       │
  out0    out1
texName  frameIdx
    │       │
    │   [pack i i]         ← frameIdx + layer を束ねる
    │       │
    │   [prepend /m4lv/42/frame]  ← OSC アドレスを付ける
    │       │
    │   [udpsend 127.0.0.1 9001]  ← 送信
    │
[jit.gl.videoplane]        ← ローカル表示（オプション）
```

### パラメータ（UI）

| パラメータ | オブジェクト | 説明 |
|---|---|---|
| 送信先 IP | `[textedit]` | デフォルト `127.0.0.1` |
| 送信先ポート | `[number]` | デフォルト `9001` |
| 有効/無効 | `[toggle]` | OSC 送信のオン/オフ |

これだけで完成。**追加の JS コードは不要。**

---

## 6. FX デバイスの設計

### コンセプト

```
┌─────────────────────────────────────────────────────┐
│  FX デバイス — テンプレート構造                       │
│                                                     │
│  [m4lv.frame_io]  ← 入力（前デバイスから）           │
│       │  │  │                                       │
│     tex  f  l                                       │
│       │                                             │
│  [jit.gl.pix @file MYSHADER.jxs]  ← ★ここだけ変える │
│       │ (out texName_fx)                            │
│       │                                             │
│  [m4lv.frame_io]  ← 出力（次デバイスへ）             │
│       ↑  ↑  ↑                                       │
│     tex  f  l                                       │
└─────────────────────────────────────────────────────┘
```

### FX デバイス作成の実際の手順（3 ステップ）

**Step 1: テンプレートをコピー**
- `devices/video_fx/video_fx.maxpat` をコピーして新デバイス名で保存

**Step 2: `jit.gl.pix` のシェーダだけ差し替え**

| FX 種類 | シェーダファイル | パラメータ |
|---|---|---|
| 輝度・コントラスト | `brcosa.jxs` (組み込み) | `val_brightness` `-1〜1`, `val_contrast` `0〜2` |
| ブラー | `fastblur.jxs` (組み込み) | `val_radius` `0〜20` |
| クロマキー | `chromakey.jxs` (組み込み) | `val_key_color`, `val_tolerance` |
| 色反転 | `invert.jxs` (独自) | `val_amount` `0〜1` |
| タイムシフト | シェーダ不要、frameIdx を加算 | `offset` (int) |
| モザイク | `pixelate.jxs` (独自) | `val_size` `1〜64` |

**Step 3: `live.dial` / `live.numbox` でパラメータを接続**

→ 完成。`m4lv.frame_io` の中身を理解する必要なし。

### タイムシフト FX の例（シェーダ不要）

```
[m4lv.frame_io]
    │       │        │
  tex    frameIdx  layer
    │       │
    │   [+ 30]   ← 1秒後ろにずらす（30fps の場合）
    │       │
    └───────┘
[m4lv.frame_io]  ← 次のデバイスへ
```

frameIdx を加算するだけ。テクスチャには触れない。

---

## 7. デバイス作成の最小手順

### OSC 出力デバイス（新規作成）

必要なオブジェクト：
1. `[m4lv.frame_io]` — 入力受取
2. `[pack i i]` + `[prepend /m4lv/X/frame]` — OSC フォーマット
3. `[udpsend 127.0.0.1 9001]` — 送信
4. `[live.numbox]` × 2 — IP・ポート設定用

**合計 5〜6 オブジェクト、JS コードゼロ。**

### GLSL FX デバイス（新規作成）

必要なオブジェクト：
1. `[m4lv.frame_io]` — 入力受取
2. `[jit.gl.pix @file myshader.jxs]` — GPU FX
3. `[m4lv.frame_io]` — 出力送出
4. `[live.dial]` × N — パラメータ

**合計 4〜8 オブジェクト、JS コードゼロ。**

---

## 8. ラック ID の自動取得

唯一の懸念点「ラック ID をどう取るか」の解決策：

### 方法 A: `live.thisdevice` ＋ `sprintf`（推奨）

```
[live.thisdevice]  → id outlet → [sprintf m4lv_%d_frame]
```

- JS 不要
- `live.thisdevice` の id はラック内での一意な整数
- アブストラクション `m4lv.frame_io` の内部に隠蔽するため、FX 作者は意識しなくてよい

### 方法 B: `[pattr rackId]` で手動設定

- ユーザーがラック ID を手動でセット
- オートメーション保存に対応
- 同一セッション内でユニーク性を保証するのはユーザー責任

### 方法 C: 固定名（シンプル最小構成）

```
[jit.gl.texture @name m4lv_default_tex]
```

- ラック ID なし = 全デバイスが同名テクスチャを共有
- 1 台構成や初期テストには十分
- 複数ラックを同時使用するときは命名が衝突するので方法 A に移行

**推奨:** アブストラクション内に方法 A を実装し、引数で上書き可能にする:
```
[m4lv.frame_io]         ← ラックIDを自動取得
[m4lv.frame_io myRack]  ← ラックIDを手動指定（オーバーライド）
```

---

## 9. まとめ — 実装方針の推奨

### 優先順位

| 優先 | 成果物 | 内容 | 工数 |
|---|---|---|---|
| 1 | `m4lv.frame_io.maxpat` | 共有アブストラクション本体 | 30 分 |
| 2 | `video_fx_template.maxpat` | FX テンプレート | 15 分 |
| 3 | `video_osc_out.maxpat` | OSC 出力デバイス | 15 分 |
| 4 | `brcosa_fx.maxpat` | 輝度/コントラスト FX（アブストラクション使用例） | 10 分 |

### 設計原則（この設計で守っていること）

1. **デバイス間で流れる情報は 3 値以下**（texName + frameIdx + layer）
2. **FX デバイスに JS ファイルは不要** — アブストラクションが全隠蔽
3. **OSC デバイスはメタデータのみ送信** — テクスチャは送らない（送れない）
4. **新しい FX はシェーダ差し替えだけで完成** — テンプレートコピー → `jit.gl.pix` 差替え
5. **ラック ID の管理はアブストラクション内部** — FX 作者は気にしなくてよい

### 信号フロー（改訂版）

```
[video_source]
  │ texName, frameIdx, layer
  ▼
[m4lv.frame_io] ──────────────────────────────────┐
  │ out: texName, frameIdx, layer                  │ (send/receive で伝搬)
  ▼                                                │
[video_fx: brcosa]    ← jit.gl.pix で GPU FX       │
  [m4lv.frame_io]                                  │
  │                                                │
  ▼                                                │
[video_fx: blur]      ← jit.gl.pix で GPU FX       │
  [m4lv.frame_io]                                  │
  │                                                │
  ▼                                                │
[video_osc_out]       ← frameIdx を OSC 送信        │
  [m4lv.frame_io]                                  │
  │                                                │
  ▼                                                │
[video_hub]           ← jit.gl.render で合成 ◄─────┘
  │
  ▼
[jit.window / NDI]
```

---

## 付録：`m4lv.frame_io.maxpat` 内部オブジェクト一覧

アブストラクションに含まれるオブジェクト（JS コードなし）：

| オブジェクト | 役割 |
|---|---|
| `live.thisdevice` | ラックデバイス ID 取得 |
| `sprintf m4lv_%d_frame` | チャンネル名を文字列生成 |
| `pack sym int int` | 3 値をまとめる |
| `unpack sym int int` | 3 値をバラす |
| `send ––` | 名前付き send（動的） |
| `receive ––` | 名前付き receive（動的） |
| `inlet` × 3 | テクスチャ名・フレーム番号・レイヤー番号の入力（各 1 個） |
| `outlet` × 3 | テクスチャ名・フレーム番号・レイヤー番号の出力（各 1 個） |

**合計 12 オブジェクト（うち `inlet`/`outlet` 各 3 個は Max アブストラクションで自動配置）、JS ゼロ。**
