# M4L Video in Arrangement View — Architecture

## 概要 / Overview

このプロジェクトは Ableton Live のアレンジメントビューで音声と同様に動画を編集できる
Max for Live デバイス群を実装します。

This project implements a set of Max for Live devices that enable video editing in
Ableton Live's Arrangement View, analogous to how audio is handled.

---

## デバイス構成 / Device Types

### `video_source` — 動画信号源 (シンセサイザーの役割)

- **トラックに 1 台**配置する。
- Ableton Live API (`live.observer`) を使って現在再生中のクリップと再生位置を監視する。
- ファイルパスと再生位置から **現在表示すべきフレーム番号** を計算する。
- 計算結果 (`VideoFrameInfo`) を 5 つのアプローチすべてでラック内の他デバイスへ共有する。

### `video_fx` — エフェクト (インサートエフェクトの役割)

- ラック内で `video_source` の後に **複数チェーン**できる。
- 上流から受け取った `VideoFrameInfo` にエフェクト（明るさ・コントラスト・ブラー・
  クロマキー・不透明度・クロップ・ズーム・タイムシフト）を適用する。
- 変更後の情報を下流へ再送出する。

### `video_hub` — ハブ (グループ/マスタートラック用)

- グループトラックまたはマスタートラックに配置する。
- 子トラックからの複数の `VideoFrameInfo` ストリームを **レイヤー**として受け取る。
- レイヤーを Z 順にソートし、設定したブレンドモード (`over` / `add` / `multiply` / `screen`)
  で合成する。
- 合成結果を親ハブや出力デバイスへ送出する。

---

## ラック内デバイス間動画情報共有方式 / Rack-Level Video Sharing Approaches

ラック内の `video_source` → `video_fx` → `video_hub` 間で動画情報を共有する方式を
5 つ実装しています。各方式は独立して利用でき、組み合わせも可能です。

### Approach 1: Named Jitter Matrix (`jit.shared`)

**ファイル:** `shared/approach1_named_matrix.js`

```
[jit.matrix 4 char 1920 1080 @name m4lv_<rackId>_matrix]
```

- Max/MSP は同じ名前を持つ `jit.matrix` オブジェクトが **同一メモリ領域を共有** します。
- `video_source` がフレームを書き込むと、同じセッション内のすべてのデバイスが
  コピーなしで読み出せます。
- **長所:** ゼロコピー、HD 動画に最適、Jitter レンダリングパイプラインとネイティブ統合。
- **短所:** 同一 Max プロセス内のみ（常に M4L では成立）。マトリクスサイズを事前合意が必要。

### Approach 2: send / receive メッセージパッシング

**ファイル:** `shared/approach2_send_receive.js`

```
[send m4lv_<rackId>_frame]  ←→  [receive m4lv_<rackId>_frame]
```

- Max の `send` / `receive` オブジェクトを使い、`VideoFrameInfo` をフラットリストとして送信。
- チャンネル名はラック ID から自動生成されるため、同一ラック内デバイスが自動的に接続。
- **長所:** ピクセルデータ不要のメタデータ転送が軽量・高速。デバッグが容易（`[print]` を接続するだけ）。
- **短所:** デフォルトはメタデータのみ。ピクセルデータは Approach 1 と組み合わせる。

### Approach 3: Shared Dictionary (`dict`)

**ファイル:** `shared/approach3_shared_dict.js`

```
[dict m4lv_<rackId>_state]  ←  [dict.view]  → 変更通知
```

- Max の `dict` オブジェクトは名前を共有することで複数パッチから読み書き可能。
- トラック ID をキーとして階層的にデータを格納 (`tracks/<trackId>/filePath` など)。
- FX デバイスもエフェクトパラメータを同じ dict に書き込む (`tracks/<id>/effects/<fxName>/`）。
- **長所:** 構造化データ。`dict.view` による自動変更通知でポーリング不要。Max エディタで
  実行時にリアルタイム検査可能。Live Set 保存時に `pattrstorage` と連携できる。
- **短所:** ピクセル操作向きではない（Approach 1 と組み合わせ推奨）。

### Approach 4: OSC (`udpsend` / `udpreceive`)

**ファイル:** `shared/approach4_osc.js`

```
[udpsend 127.0.0.1 <port>]  ←→  [udpreceive <port>]
OSC アドレス: /m4lv/<rackId>/frame
```

- ループバック UDP で OSC メッセージを送受信。
- ポート番号はラック ID から自動計算（`9000 + rackId % 1000`）。
- OSC アドレスパターン:
  - `/m4lv/<rackId>/frame`  — フレームメタデータ
  - `/m4lv/<rackId>/fx`     — FX パラメータ更新
  - `/m4lv/<rackId>/layer`  — レイヤー順序変更
- **長所:** アプリケーション横断（TouchDesigner・Resolume など外部ツールとの連携に最適）。
  OSC モニタリングツールでデバッグ容易。将来的にはネットワーク越しの拡張も可能。
- **短所:** ピクセルデータ非対応。ポート番号の調整が必要。

### Approach 5: pattr / autopattr パラメータシステム

**ファイル:** `shared/approach5_pattr.js`

```
[autopattr]  →  [pattrstorage m4lv_<rackId>_params @autoread 1 @autosave 1]
```

- Max の `pattr` / `pattrstorage` システムを使い、**オートメーション可能なパラメータ**
  としてデバイス間でコントロール値を共有。
- `opacity`・`scaleX`・`scaleY`・`posX`・`posY`・`rotation`・`layer`・`blendMode`・
  `timeOffset` が Live のオートメーションレーンや MIDI マッピングと連動。
- **長所:** Live のオートメーション・MIDI マッピング・モジュレーションシステムと完全統合。
  Live Set 保存時に自動保存・復元。
- **短所:** スカラーコントロールパラメータのみ。ピクセルデータや動画ファイルパスの共有には不適。

---

## データ構造 / Data Structures

**ファイル:** `shared/video_frame_info.js`

`VideoFrameInfo` オブジェクトは以下のフィールドを持ちます:

| フィールド | 型 | 説明 |
|---|---|---|
| `trackId` | string | Live トラック ID |
| `clipId` | string | Live クリップ ID |
| `playheadTime` | number | アレンジメント再生ヘッド位置（秒） |
| `clipStartTime` | number | クリップのアレンジメント開始位置（秒） |
| `clipLength` | number | クリップ長（秒） |
| `localTime` | number | クリップ内の再生位置（秒） |
| `filePath` | string | 動画ファイルの絶対パス |
| `frameRate` | number | ソース動画のフレームレート (fps) |
| `frameIndex` | number | 表示すべきフレーム番号（0 始まり） |
| `width` | number | フレーム幅（ピクセル） |
| `height` | number | フレーム高（ピクセル） |
| `layer` | number | Z 順レイヤーインデックス（大きいほど前面） |
| `transform` | object | 空間変換: `{x, y, scaleX, scaleY, rotation, opacity}` |
| `effects` | object | FX パラメータバッグ（FX 名をキーとする） |

---

## 信号フロー / Signal Flow

```
[Arrangement View]
     │ clip position → live.observer
     ▼
[video_source]  ──(5 approaches)──►  [video_fx 1]  ──►  [video_fx 2]  ──►  [video_hub (Group)]
                                                                                     │
                                                                              (5 approaches)
                                                                                     ▼
                                                                          [video_hub (Master)]
                                                                                     │
                                                                                     ▼
                                                                          [jit.window / NDI / etc.]
```

---

## 命名規則 / Naming Convention

すべての共有オブジェクトはラック ID をプレフィックスに持ちます:

| オブジェクト | 名前パターン |
|---|---|
| Named Matrix (source) | `m4lv_<rackId>_matrix` |
| Named Matrix (FX) | `m4lv_<rackId>_matrix_<fxName>` |
| Named Matrix (Hub output) | `m4lv_<rackId>_hub_output` |
| send/receive channel | `m4lv_<rackId>_frame` |
| Shared dict | `m4lv_<rackId>_state` |
| pattrstorage | `m4lv_<rackId>_params` |
| OSC address (frame) | `/m4lv/<rackId>/frame` |
| OSC address (FX) | `/m4lv/<rackId>/fx` |
| OSC address (layer) | `/m4lv/<rackId>/layer` |

---

## セットアップ手順 / Setup

1. `devices/video_source/` フォルダを M4L デバイスとして Ableton に追加。
2. 動画を含む各トラックの **Instrument/Effect Rack** に `video_source` を配置。
3. FX が必要なら `video_fx` を同じラックに追加（複数可）。
4. グループトラックに `video_hub` を配置し、子トラックの ID を登録 (`addTrack` メッセージ)。
5. マスタートラックにもう一台 `video_hub` を配置してグループの出力を受け取る。
6. `video_hub` の出力マトリクスを `jit.window` や NDI 出力に接続して映像を確認。

---

## 方式比較サマリー / Approach Comparison

| | Approach 1 Named Matrix | Approach 2 send/receive | Approach 3 dict | Approach 4 OSC | Approach 5 pattr |
|---|---|---|---|---|---|
| ピクセルデータ | ✅ ゼロコピー | ✅ matrix ref | ❌ | ❌ | ❌ |
| メタデータ | ✅ | ✅ | ✅ | ✅ | △ スカラーのみ |
| 外部アプリ連携 | ❌ | ❌ | ❌ | ✅ | ❌ |
| Live オートメーション | ❌ | ❌ | ❌ | ❌ | ✅ |
| パフォーマンス | 最高 | 高 | 中 | 低〜中 | 高 |
| デバッグのしやすさ | △ | ✅ | ✅ | ✅ | ✅ |
| Live Set 保存 | ❌ | ❌ | △ | ❌ | ✅ |

**推奨構成:** Approach 1（ピクセル転送） + Approach 3（メタデータ/FX パラメータ） + Approach 5（オートメーション）を組み合わせる。

---

## 詳細ドキュメント / Detailed Documentation

### 各方式の内部仕組み・遅延・maxpat 構造

**[docs/approach_details.md](./approach_details.md)**

- 各 Approach の内部アルゴリズムと Max ランタイムの動作原理
- フェーズ別遅延の定量評価と比較表
- `video_source.maxpat` / `video_fx.maxpat` / `video_hub.maxpat` のオブジェクト一覧・ワイヤリング図・初期化シーケンス

### GPU テクスチャパス — 動画はテクスチャ状態で扱うべきか？

**[docs/gpu_texture_path.md](./gpu_texture_path.md)**

- CPU マトリクス (`jit.matrix`) と GPU テクスチャ (`jit.gl.texture`) の根本的な違い
- `jit.gl.render` によるマルチレイヤー GPU 合成
- GLSL シェーダ FX (`jit.gl.pix`) と CPU FX の対応表
- パフォーマンス比較（FPS スケーラビリティ）
- CPU パスと GPU パスを使い分けるべき場面
- このプロジェクトへの移行ステップ
- 命名規則の拡張 (`m4lv_<rackId>_tex`, `m4lv_<rackId>_render` …)
