# 動画はテクスチャ状態で扱うべきか？ — GPU テクスチャパス詳解

> **この文書が答える問い:**  
> 「動画を扱うのは基本的にテクスチャの状態？」
>
> **結論:**  
> はい。パフォーマンスを重視するならば、動画フレームは**できる限り GPU 上のテクスチャ
> （VRAM）として扱う**べきです。Jitter の `jit.gl.texture` がその役割を担います。

---

## 目次

1. [CPU マトリクスと GPU テクスチャ — 根本的な違い](#1-cpu-マトリクスと-gpu-テクスチャ--根本的な違い)
2. [現在の実装：CPU マトリクスパス](#2-現在の実装cpu-マトリクスパス)
3. [GPU テクスチャパス — 仕組みの詳解](#3-gpu-テクスチャパス--仕組みの詳解)
4. [テクスチャの名前共有](#4-テクスチャの名前共有)
5. [レンダーコンテキストの共有と合成](#5-レンダーコンテキストの共有と合成)
6. [GPU 上での FX — GLSL シェーダ](#6-gpu-上での-fx--glsl-シェーダ)
7. [遅延とパフォーマンスの比較](#7-遅延とパフォーマンスの比較)
8. [いつ CPU マトリクスを使うか](#8-いつ-cpu-マトリクスを使うか)
9. [このプロジェクトへの適用指針](#9-このプロジェクトへの適用指針)
10. [maxpat サンプル — GPU テクスチャパス](#10-maxpat-サンプル--gpu-テクスチャパス)
11. [命名規則の拡張](#11-命名規則の拡張)

---

## 1. CPU マトリクスと GPU テクスチャ — 根本的な違い

### メモリの居場所

| | CPU マトリクス (`jit.matrix`) | GPU テクスチャ (`jit.gl.texture`) |
|---|---|---|
| データの保存場所 | CPU の RAM (システムメモリ) | GPU の VRAM (グラフィックスメモリ) |
| アクセス主体 | CPU コア | GPU シェーダコア (数千並列) |
| Jitter オブジェクト | `jit.matrix`, `jit.brcosa`, `jit.op` | `jit.gl.texture`, `jit.gl.pix`, `jit.gl.render` |
| FHD ARGB (1920×1080) のサイズ | 約 8 MB | 約 8 MB (同じ、場所が違う) |

動画の「フレーム」とは本質的にはピクセルデータの二次元配列です。  
そのデータが CPU 側のメモリにあるか GPU 側のメモリにあるかが、  
**「マトリクス状態」と「テクスチャ状態」の違い**です。

### なぜ GPU テクスチャが有利か

CPU でピクセル操作を行う場合、1 フレーム = 200万ピクセル（FHD）を  
1 コアまたは数コアで逐次処理します。  
GPU の場合、数千のシェーダコアが 200万ピクセルを**完全並列**で処理します。

さらに重要なのは**データ転送のコスト**です:

```
CPU マトリクスパス:
  デコード(CPU) → CPU RAM に保存 → [CPU FX] → CPU RAM → GPU にアップロード → 描画

GPU テクスチャパス:
  デコード(CPU) → 一度だけ GPU にアップロード → [GPU FX + 合成] → 描画
                              ↑
                     ここだけ CPU↔GPU 転送
```

CPU↔GPU 間のメモリ転送（PCIe 帯域幅）は非常にコストが高く、  
FHD 1 フレーム（8 MB）の転送だけで 0.5〜2 ms かかることがあります。  
テクスチャパスはこの転送を **1 フレームにつき 1 回（アップロード時のみ）** に抑えます。

---

## 2. 現在の実装：CPU マトリクスパス

現在のプロジェクト（Approach 1）は CPU マトリクスパスを使用しています。

### 信号フロー

```
[jit.qt.movie]                      ← ビデオファイルのデコード (CPU)
    │ (decoded frame: ARGB matrix, CPU RAM ~8MB)
    ▼
[jit.matrix 4 char 1920 1080        ← CPU RAM に保存・共有
 @name m4lv_<rackId>_matrix]
    │ (CPU コピーなし — 名前共有で同一メモリ参照)
    ▼
[jit.brcosa]                        ← 輝度/コントラスト (CPU 演算)
[jit.fastblur]                      ← ぼかし (CPU 演算)
[jit.chromakey]                     ← クロマキー (CPU 演算)
    │
    ▼
[jit.op @op sfade]                  ← Alpha-over 合成 (CPU 演算)
    │
    ▼
[jit.window]                        ← GPU にアップロード (PCIe 転送) → 表示
```

### CPU パスの弱点

1. すべての FX が CPU シングルスレッドで実行される
2. `jit.op @op sfade` のレイヤー合成も CPU で行われる
3. `jit.window` で表示するたびに 8 MB を GPU に転送（8 MB × 30 fps × N トラック）
4. 4K 解像度では 32 MB × 30 fps = 960 MB/s の PCIe 転送が必要になる

---

## 3. GPU テクスチャパス — 仕組みの詳解

### キーオブジェクト

#### `jit.gl.texture`

GPU テクスチャを管理するオブジェクト。`@name` 属性を指定することで、  
`jit.matrix` と同様に**同一 Max セッション内での名前共有**が可能。

```
[jit.gl.texture @name m4lv_X_tex @type char @mode 0]
```

- `@type char`  : ARGB 8bit/チャンネル (CPU パスと同じ精度)
- `@mode 0`     : テクスチャを内部で管理 (`@mode 1` は外部バインド用)
- `@rectangle 1`: 非 POT (Power-of-Two) 解像度を許可 (Max 7+)

`jit.matrix` からの入力（CPU RAM）を受け取ると自動的に GPU にアップロードします:

```
[jit.qt.movie] → [jit.gl.texture @name m4lv_X_tex]
                      ↑
                  1フレームに1回だけ CPU→GPU 転送。以降は VRAM に滞留。
```

#### `jit.gl.videoplane`

テクスチャを OpenGL の四角形ポリゴンに貼り付けて描画するオブジェクト。  
位置・スケール・回転を指定でき、これが FX デバイスの「変換」を担います。

```
[jit.gl.videoplane
 @texture m4lv_X_tex    ← 使用するテクスチャ名
 @name    m4lv_X_render ← 所属するレンダーコンテキスト名
 @position 0 0 0
 @scale    1 1 1
 @rotate   0 0 1 0]
```

#### `jit.gl.render`

OpenGL のレンダーコンテキスト（フレームバッファ）を管理するオブジェクト。  
同じ `@name` を持つすべての `jit.gl.videoplane` / `jit.gl.pix` を  
1 回のドローコールで合成します。

```
[jit.gl.render @name m4lv_X_render
 @size 1920 1080
 @bgcolor 0 0 0 0]   ← 透明背景（アルファ合成対応）
```

#### `jit.gl.pix`

GLSL シェーダを GPU 上で実行する FX オブジェクト。  
入力テクスチャに対してピクセルシェーダを適用し、出力テクスチャを生成します。

```
[jit.gl.pix @file brcosa.jxs
 @name m4lv_X_render
 @val_brightness 0.0
 @val_contrast   1.0
 @val_saturation 1.0]
```

### GPU パスの信号フロー

```
[jit.qt.movie]
    │ (decoded ARGB matrix — CPU RAM, 一時的)
    ▼
[jit.gl.texture @name m4lv_X_tex]
    │ (1回だけ CPU→GPU アップロード)
    │ テクスチャはここから VRAM に滞留
    ▼
[jit.gl.pix @file brcosa.jxs @name m4lv_X_render]   ← GPU シェーダ FX
    │
[jit.gl.pix @file fastblur.jxs @name m4lv_X_render]  ← GPU シェーダ FX
    │
[jit.gl.videoplane @texture m4lv_X_tex @name m4lv_X_render]  ← 位置・スケール・回転
    │
[jit.gl.render @name m4lv_X_render]                 ← GPU 上で全レイヤー合成
    │
[jit.window]                                         ← 完成フレームを表示
```

---

## 4. テクスチャの名前共有

名前付きテクスチャの共有は、名前付きマトリクスと完全に対称的です。

### 比較

| | CPU マトリクス | GPU テクスチャ |
|---|---|---|
| オブジェクト | `jit.matrix @name X` | `jit.gl.texture @name X` |
| 共有の仕組み | Jitter の名前レジストリ（CPU RAM ポインタ共有） | Jitter の GL テクスチャレジストリ（GPU テクスチャ ID 共有） |
| 書き込み | `jit.qt.movie` → `jit.matrix` | `jit.qt.movie` → `jit.gl.texture` |
| 読み出し | 同名の `jit.matrix` を参照 | 同名の `jit.gl.videoplane @texture X` を指定 |
| コスト | ゼロコピー（CPU RAM 内） | ゼロコピー（VRAM 内） |

### 実装パターン

```
video_source デバイス:
  [jit.qt.movie] → [jit.gl.texture @name m4lv_X_tex_trackA]
                            ↑ テクスチャを VRAM に書き込む

video_fx デバイス:
  [jit.gl.pix @file myshader.jxs]
    @input  m4lv_X_tex_trackA   ← 同名テクスチャを VRAM から直接読む
    @output m4lv_X_tex_trackA_fx ← FX 処理後を別名テクスチャに書く

video_hub デバイス:
  [jit.gl.videoplane @texture m4lv_X_tex_trackA_fx @name m4lv_X_render]
  [jit.gl.videoplane @texture m4lv_X_tex_trackB_fx @name m4lv_X_render]
  [jit.gl.render @name m4lv_X_render]  ← GPU 上で合成
```

---

## 5. レンダーコンテキストの共有と合成

GPU テクスチャパスの最大の利点のひとつは、**複数レイヤーの合成が GPU 上で完結する**ことです。

### 合成の仕組み

`jit.gl.render` は所属するすべての GL オブジェクトを**1 回のフレームバッファ描画**にまとめます。  
CPU パスの `jit.op @op sfade` が逐次 2 枚ずつ合成するのと異なり、  
GPU は全レイヤーを **1 パスで同時合成**できます。

```
                    GPU VRAM
                    ──────────────────────────────────────
m4lv_X_tex_track1 ──→ [jit.gl.videoplane] ─┐
m4lv_X_tex_track2 ──→ [jit.gl.videoplane] ─┤→ [jit.gl.render @name m4lv_X_render]
m4lv_X_tex_track3 ──→ [jit.gl.videoplane] ─┘        │
                                                       ▼
                                              フレームバッファ (VRAM)
                                                       │
                                              [jit.window] (表示)
```

OpenGL のブレンドモードは `@blend_enable 1` と `@blend_mode` 属性で設定します:

| ブレンドモード | OpenGL blend_mode | 意味 |
|---|---|---|
| Alpha-over (over) | `6 1` (src_alpha, one_minus_src_alpha) | 標準アルファ合成 |
| 加算 (add)       | `1 1` (one, one) | 明るさを加算 |
| 乗算 (multiply)  | `4 3` (dst_color, zero) | カラーを乗算 |
| スクリーン (screen) | `1 5` (one, one_minus_src_color) | 輝度が反転して重なる |

---

## 6. GPU 上での FX — GLSL シェーダ

### CPU FX との対応

`jit.gl.pix` に組み込み Jitter シェーダ（`.jxs` ファイル）を渡すことで、  
CPU パスの `jit.brcosa` 等を GPU 上のシェーダに置き換えられます。

| CPU FX オブジェクト | GPU シェーダ (jit.gl.pix @file …) | ユニフォームパラメータ |
|---|---|---|
| `jit.brcosa` | `brcosa.jxs` (Jitter 組み込み) | `val_brightness`, `val_contrast`, `val_saturation` |
| `jit.fastblur` | `fastblur.jxs` または `blur.jxs` | `val_radius` |
| `jit.chromakey` | `chromakey.jxs` | `val_key_color`, `val_key_tolerance` |
| `jit.rota` (回転) | `jit.gl.videoplane` の transform | `@rotate`, `@scale`, `@position` |
| `jit.op @op sfade` | `jit.gl.render` の OpenGL ブレンド | `@blend_enable`, `@blend_mode` |

### カスタム GLSL シェーダの例

```glsl
/* video_invert.jxs — 色反転シェーダの例 */
<jitter-shader>
  <param name="val_amount" default="1.0" type="float"/>
  <language name="glsl" version="1.2">
  <![CDATA[
    uniform sampler2DRect tex0;
    uniform float val_amount;
    void main() {
        vec4 src = texture2DRect(tex0, texcoord0.xy);
        vec4 inv = vec4(1.0) - src;
        gl_FragColor = mix(src, inv, val_amount);
        gl_FragColor.a = src.a; /* アルファは保持 */
    }
  ]]>
  </language>
</jitter-shader>
```

このシェーダを `jit.gl.pix @file video_invert.jxs` として使えば、  
CPU でのピクセル反転よりも桁違いに高速に処理できます。

---

## 7. 遅延とパフォーマンスの比較

### CPU マトリクス vs GPU テクスチャ

| フェーズ | CPU マトリクスパス | GPU テクスチャパス | 差 |
|---|---|---|---|
| デコード (jit.qt.movie) | 1〜5 ms | 1〜5 ms | 同じ（両方 CPU デコード）|
| CPU→GPU アップロード | 毎フレーム末尾 0.5〜2 ms | デコード直後 0.5〜2 ms | 同じ、タイミングが違う |
| 輝度調整 FX | jit.brcosa: 1〜5 ms | brcosa.jxs GPU: 0.05〜0.3 ms | **GPU が 10〜100× 速い** |
| ブラー FX | jit.fastblur: 2〜20 ms | fastblur.jxs GPU: 0.1〜1 ms | **GPU が 10〜20× 速い** |
| 2 レイヤー合成 | jit.op sfade: 1〜5 ms | jit.gl.render: 0.1〜0.5 ms | **GPU が 10× 速い** |
| 8 レイヤー合成 | jit.op × 7 段: 7〜35 ms | jit.gl.render × 1 パス: 0.2〜1 ms | **GPU が 35× 速い** |
| **FHD 30fps 予算 (33 ms)** | FX + 合成で **消費 15〜60 ms** | FX + 合成で **消費 0.5〜5 ms** | |

### FPS スケーラビリティ

| 構成 | CPU パス最大 fps | GPU パス最大 fps |
|---|---|---|
| FHD, FX なし, 2 レイヤー | ~45 fps | ~120 fps |
| FHD, 3 FX, 4 レイヤー | ~12 fps | ~90 fps |
| 4K, 3 FX, 4 レイヤー | ~3 fps | ~60 fps |

*実測値はシステム構成・GPU モデル・FX の種類に大きく依存します。*

---

## 8. いつ CPU マトリクスを使うか

GPU テクスチャパスが常に優れているわけではありません。  
以下のケースでは CPU マトリクスが適切または必要です。

| ユースケース | 理由 | 推奨パス |
|---|---|---|
| **Syphon / NDI / Spout 出力** | これらは CPU RAM からのフレームコピーを要求する | CPU (Approach 1) |
| **ヒストグラム・動き検出** | ピクセル値の数値アクセスは CPU でのみ可能 | CPU |
| **フレーム差分の計算** | `jit.op @op absdiff` 等は CPU 演算 | CPU |
| **ファイル書き出し (jit.movie.record)** | エンコーダは CPU RAM のマトリクスを要求 | CPU |
| **デバッグ** | CPU マトリクスは Max の Matrix Viewer で直接確認できる | CPU |
| **GPU が弱いシステム** | 統合グラフィクス等で GPU 帯域幅が低い場合 | CPU |
| **コーデック処理** | H.264 等のデコードは CPU 側で完結する | CPU (中間のみ) |

**ハイブリッド推奨構成:**

```
jit.qt.movie (CPU デコード)
    │
    ├─→ jit.gl.texture  ← GPU パス (リアルタイム表示・FX・合成)
    │
    └─→ jit.matrix      ← CPU パス (Syphon/NDI 出力・フレーム分析)
         (GPU→CPU readback は必要時のみ)
```

---

## 9. このプロジェクトへの適用指針

### 現在の実装（CPU パス）を活かす場面

- シンプルなテスト・デバッグフェーズ
- FX が不要・単一レイヤーの構成
- Syphon/NDI 出力が主な用途

### GPU テクスチャパスに移行すべき場面

- 4 トラック以上の同時再生
- リアルタイム FX（ブラー・クロマキー・カラーグレード）を複数段かける
- 60fps 以上のターゲット解像度が 1080p 以上の場合

### 移行ステップ

1. `video_source.maxpat` に `jit.gl.texture @name m4lv_<rackId>_tex` を追加
2. `jit.qt.movie` の matrix outlet を `jit.matrix` と `jit.gl.texture` の両方に接続
   （既存の CPU パスを壊さずに GPU パスを追加できる）
3. `video_fx.maxpat` に `jit.gl.pix @file brcosa.jxs` 等を追加
4. `video_hub.maxpat` に `jit.gl.videoplane` + `jit.gl.render` を追加
5. `shared/approach_gl_texture.js` がこれらのオブジェクト名と制御メッセージを管理する

### パスの選択フロー

```
リアルタイム表示・FX・合成が必要？
  Yes → GPU テクスチャパス (jit.gl.texture + jit.gl.render)
  No  →
    Syphon/NDI/フレーム分析が必要？
      Yes → CPU マトリクスパス (jit.matrix) + 必要時のみ GPU readback
      No  → どちらでも可（単純な再生なら CPU で十分）
```

---

## 10. maxpat サンプル — GPU テクスチャパス

### video_source（GPU テクスチャパス版）

```
オブジェクト追加・変更箇所:

既存:
  [jit.qt.movie] → [jit.matrix @name m4lv_X_matrix]  (CPU パスは維持)

追加:
  [jit.qt.movie]
      │ (matrix outlet)
      ▼
  [jit.gl.texture @name m4lv_X_tex       ← GPU テクスチャ（新規追加）
   @type char @rectangle 1]
      │ (texture name outlet)
  [js approach_gl_texture.js]            ← 新モジュール
      │ outlet 0 (texture name)
  [send m4lv_X_frame_gpu]                ← GPU フレーム通知用チャンネル
```

### video_fx（GPU テクスチャパス版）

```
既存の jit.brcosa の代わりに:

  [receive m4lv_X_frame_gpu]             ← GPU テクスチャ名を受信
      │
  [jit.gl.pix @file brcosa.jxs          ← GPU ブライトネス/コントラスト
   @name m4lv_X_render]
      │ val_brightness ← [live.dial]
      │ val_contrast   ← [live.dial]
  [jit.gl.pix @file fastblur.jxs        ← GPU ブラー（必要時のみ）
   @name m4lv_X_render]
```

### video_hub（GPU テクスチャパス版）

```
既存の jit.op @op sfade の代わりに:

  [receive m4lv_X_frame_gpu track_A]
      │ (texture name: m4lv_X_tex_A_fx)
  [jit.gl.videoplane @name m4lv_X_render   ← Track A レイヤー
   @texture m4lv_X_tex_A_fx @layer 0]

  [receive m4lv_X_frame_gpu track_B]
      │
  [jit.gl.videoplane @name m4lv_X_render   ← Track B レイヤー
   @texture m4lv_X_tex_B_fx @layer 1]

  [jit.gl.render @name m4lv_X_render       ← GPU で全レイヤーを 1 パス合成
   @size 1920 1080
   @blend_enable 1
   @blend_mode 6 1]                        ← Alpha-over
      │
  [jit.window]                             ← 表示
```

---

## 11. 命名規則の拡張

GPU テクスチャパスで使用する新しい命名規則:

| オブジェクト | 名前パターン |
|---|---|
| GPU テクスチャ (source) | `m4lv_<rackId>_tex` |
| GPU テクスチャ (トラック別) | `m4lv_<rackId>_tex_<trackId>` |
| GPU テクスチャ (FX後) | `m4lv_<rackId>_tex_<trackId>_fx` |
| GL レンダーコンテキスト | `m4lv_<rackId>_render` |
| GPU send/receive チャンネル | `m4lv_<rackId>_frame_gpu` |

これにより既存の CPU パス名（`m4lv_<rackId>_matrix`, `m4lv_<rackId>_frame`）と  
衝突しないため、CPU パスと GPU パスを**同一セッション内で並行稼働**できます。
