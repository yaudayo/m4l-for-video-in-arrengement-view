# m4l-for-video-in-arrengement-view

Ableton Live のアレンジメントビューで音声と同じ操作感で動画編集ができる
Max for Live デバイス群のリファレンス実装です。

A reference implementation of Max for Live devices that bring audio-like video
editing to Ableton Live's Arrangement View.

---

## プロジェクト構成 / Project Structure

```
devices/
  video_source/          # 動画信号源デバイス（トラックに 1 台）
    video_source.js      #   Max js オブジェクト用スクリプト
    video_source.maxpat  #   Max パッチ定義 (JSON)
  video_fx/              # 動画エフェクトデバイス（ラック内に複数配置可）
    video_fx.js
    video_fx.maxpat
  video_hub/             # レイヤー合成ハブ（グループ/マスタートラック用）
    video_hub.js
    video_hub.maxpat
shared/
  video_frame_info.js    # 共有データ構造 VideoFrameInfo
  approach1_named_matrix.js  # 共有方式 1: Named Jitter Matrix
  approach2_send_receive.js  # 共有方式 2: send/receive メッセージ
  approach3_shared_dict.js   # 共有方式 3: 共有 dict
  approach4_osc.js           # 共有方式 4: OSC / UDP
  approach5_pattr.js         # 共有方式 5: pattr パラメータシステム
docs/
  architecture.md        # アーキテクチャ詳細説明
tests/
  video_frame_info.test.js  # ユニットテスト (Node.js)
```

## テスト実行 / Running Tests

```bash
node tests/video_frame_info.test.js
```

## 詳細 / Documentation

アーキテクチャ、デバイス間の動画情報共有方式の比較、セットアップ手順は
[docs/architecture.md](docs/architecture.md) を参照してください。