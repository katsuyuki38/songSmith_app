# SongSmith Vocal Engine Setup

SongSmith Vocal Studio は2種類の歌唱バックエンドを使えます。

## A. VOICEVOX ENGINE（まずはこちら）

現在の VOICEVOX ENGINE には公式の歌唱APIがあり、MIDIノート番号・フレーム長・1モーラ歌詞から歌声を生成できます。

### 1. VOICEVOX ENGINE を起動

CPU版Dockerの例:

```bash
docker pull voicevox/voicevox_engine:cpu-latest
docker run --rm -p 127.0.0.1:50021:50021 voicevox/voicevox_engine:cpu-latest
```

起動確認:

```bash
curl http://127.0.0.1:50021/version
curl http://127.0.0.1:50021/singers
```

### 2. SongSmith Vocal API を起動

`.env.local`:

```env
VOCAL_ENGINE=voicevox
VOCAL_API_PORT=8790
VOICEVOX_ENGINE_URL=http://127.0.0.1:50021
VOICEVOX_SING_STYLE=6000
VOICEVOX_FRAME_STYLE=3001
```

起動:

```bash
npm install
npm run vocal-api
```

確認:

```bash
curl http://127.0.0.1:8790/health
curl http://127.0.0.1:8790/voices
```

Vocal Studioの公開画面から `neural.html` を開き、Vocal API URLに `http://127.0.0.1:8790` を設定して「ニューラル歌声生成」を押します。

> 公開HTTPSページからローカルHTTP APIへ接続できないブラウザ環境では、Cloudflare Tunnel等でVocal APIをHTTPS公開して、そのHTTPS URLを指定してください。

## B. OpenVPI DiffSinger（高品質化・独自歌手向け）

`vocal-engine/README.md` を参照してください。

SongSmith側は `.ds` JSON の `ph_seq`, `ph_dur`, `ph_num`, `note_seq`, `note_dur`, `note_slur` を生成し、Python engineから公式 `scripts/infer.py acoustic` を呼び出します。

## Engine切り替え

```env
VOCAL_ENGINE=voicevox
```

または

```env
VOCAL_ENGINE=diffsinger
```

`auto` の場合は VOICEVOX が設定されていればVOICEVOX、なければDiffSingerを使用します。

## 注意

歌声モデル・キャラクターごとの利用規約を確認してください。実在人物の声を本人の同意なく再現する用途には使用しないでください。
