# SongSmith + VOICEVOX を Railway に公開する

Mac miniを使わず、Railway上で次の2サービスを動かします。

```text
Internet
  |
  v
vocal-api  (公開 / voice.test.noinoi.xyz)
  |
  | Railway private network
  v
voicevox   (非公開 / voicevox.railway.internal:50021)
```

VOICEVOX本体は外部公開せず、SongSmith Vocal APIだけをHTTPS公開します。

## 1. Railwayプロジェクトを作る

Railwayで空のProjectを作成します。Environmentは新規のProductionを使用します。

## 2. VOICEVOXサービスを追加する

Projectの `+ New` から `Docker Image` を選び、次を指定します。

```text
voicevox/voicevox_engine:cpu-latest
```

Service名を次に変更します。

```text
voicevox
```

Variablesに次を設定します。

```text
VV_HOST=::
VV_PORT=50021
VV_CPU_NUM_THREADS=2
VV_DISABLE_MUTABLE_API=1
VV_OUTPUT_LOG_UTF8=1
```

VOICEVOXサービスにはPublic Domainを付けません。

## 3. Vocal APIサービスを追加する

同じProjectで `+ New` → `GitHub Repo` を選び、次のリポジトリを接続します。

```text
katsuyuki38/songSmith_app
```

Branch:

```text
main
```

Service名:

```text
vocal-api
```

Service SettingsのConfig as Codeに、次のファイルを指定します。

```text
/railway-vocal-api.json
```

Variablesに次を設定します。

```text
VOICEVOX_ENGINE_URL=http://voicevox.railway.internal:50021
ALLOWED_ORIGINS=https://test.noinoi.xyz
VOCAL_API_KEY=十分に長いランダム文字列
VOICEVOX_TIMEOUT_MS=180000
VOCAL_MAX_NOTES=512
```

`VOICEVOX_SING_STYLE` と `VOICEVOX_FRAME_STYLE` は通常は設定不要です。APIが `/singers` から歌唱用スタイルを自動検出します。

## 4. Railwayの仮ドメインで確認する

`vocal-api` の Settings → Networking → Public NetworkingでRailway Domainを生成します。

生成されたドメインの末尾に `/health` を付け、次のようなJSONが返ることを確認します。

```json
{
  "ok": true,
  "activeEngine": "voicevox",
  "voicevoxReachable": true,
  "apiKeyRequired": true
}
```

## 5. 独自ドメインを設定する

`vocal-api` のCustom Domainに次を追加します。

```text
voice.test.noinoi.xyz
```

Railwayが表示するCNAMEレコードとTXTレコードをCloudflare DNSへ追加します。

CloudflareのProxyは、最初はDNS onlyで接続を確認し、Railway側の証明書発行後に必要に応じてProxiedへ変更します。

## 6. 公開画面から接続する

SongSmithの画面を開きます。

```text
https://test.noinoi.xyz/songsmith/
```

VOICEVOX歌唱出力で次を入力します。

```text
Vocal API URL: https://voice.test.noinoi.xyz
APIキー: RailwayのVOCAL_API_KEYと同じ文字列
```

その後、次の順で確認します。

1. `接続確認`
2. `VOICEVOXで歌声生成`
3. 音声プレーヤーで再生
4. `WAV保存`

## トラブルシューティング

### `/health` が503になる

- `VOICEVOX_ENGINE_URL` が `http://voicevox.railway.internal:50021` になっているか確認します。
- VOICEVOXサービス名が `voicevox` になっているか確認します。
- VOICEVOXのDeploy Logsで50021番ポートに起動しているか確認します。

### `unauthorized` が返る

SongSmith画面に入力したAPIキーと、Railwayの `VOCAL_API_KEY` が一致していません。

### `cors_origin_denied` が返る

`ALLOWED_ORIGINS` に公開画面のOriginを追加します。複数指定する場合はカンマ区切りです。

```text
ALLOWED_ORIGINS=https://test.noinoi.xyz,https://別のドメイン.example
```

### 歌唱スタイルを検出できない

まずVocal APIの `/voices` をAPIキー付きで確認します。必要なら、返されたstyle IDをVariablesへ明示します。

```text
VOICEVOX_SING_STYLE=6000
VOICEVOX_FRAME_STYLE=3001
```

## セキュリティ

- VOICEVOXサービスにはPublic Domainを付けません。
- `VOCAL_API_KEY` をGitHubへコミットしません。
- `VV_DISABLE_MUTABLE_API=1` でVOICEVOXの変更系APIを無効化します。
- `ALLOWED_ORIGINS` を公開画面のドメインに限定します。
