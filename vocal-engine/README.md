# SongSmith DiffSinger Engine

SongSmith Vocal Studio から OpenVPI DiffSinger を呼び出すための薄いHTTPラッパーです。

## 役割

1. SongSmith の Node API がノート/歌詞を DiffSinger `.ds` JSON に変換
2. この FastAPI サービスが `.ds` を一時ファイルとして保存
3. OpenVPI DiffSinger の公式CLI `scripts/infer.py acoustic` を実行
4. 生成された WAV をブラウザへ返却

## 必要なもの

- OpenVPI DiffSinger のチェックアウト
- 使用する acoustic model の checkpoint
- そのモデルが要求する vocoder checkpoint
- DiffSinger 自体の Python 環境

## 起動例

```bash
cd vocal-engine
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

export DIFFSINGER_ROOT=/path/to/DiffSinger
export DIFFSINGER_EXP=my_acoustic_model
export DIFFSINGER_PYTHON=/path/to/diffsinger/python
export DIFFSINGER_SPEAKER=
export DIFFSINGER_LANG=ja
uvicorn app:app --host 0.0.0.0 --port 8800
```

別ターミナルで SongSmith の bridge API を起動します。

```bash
DIFFSINGER_ENGINE_URL=http://127.0.0.1:8800 npm run vocal-api
```

確認:

```bash
curl http://127.0.0.1:8800/health
curl http://127.0.0.1:8790/health
```

## 注意

DiffSinger のモデルごとに辞書/音素セットが異なる場合があります。`server/vocal-server.js` の日本語G2Pは一般的な日本語CV音素を初期値として実装しているため、使用する歌声モデルの辞書に合わせて音素名を調整してください。

実在人物の声を本人の同意なく再現する用途には使用しないでください。
