# SongSmith AI (Prototype)

AI作曲支援Webアプリのプロトタイプレポジトリ。GPTの提案（現在はモック）を受け取り、ピアノロールで確認・簡易編集・再生・MIDI書き出し・ローカル保存までを縦切りで確認できます。

リポジトリ: https://github.com/katsuyuki38/songSmith_app

## セットアップ

```bash
npm install
# フロント+APIを一括起動（OpenAIキーが必要）
OPENAI_API_KEY=... npm run dev:full

# 片方だけ起動も可
# フロントのみ: npm run dev
# APIのみ: OPENAI_API_KEY=... npm run api
```

環境変数は `.env.local` に保存してください（Git管理外）。例は `.env.example` を参照。
- 生成長: `TARGET_SONG_BARS`（デフォルト 32）。長すぎる場合は16などに下げてください。
- フロントのAIリクエストは20秒でタイムアウトし、失敗時はモックにフォールバックします。

## 主要機能（現状）
- 課題入力フォーム（プロンプト・キー・BPM・セクション・タグ）とプリセット
- GPT作曲API（OpenAI）※失敗時はモックにフォールバック
- ピアノロール簡易表示 + ノートの音高/長さの簡易編集
- Tone.js によるブラウザ再生、@tonejs/midi でのMIDI書き出し
- localStorage へのプロジェクト保存/ロード/削除

## コードの見どころ
- `src/App.tsx` … UI全体・再生・MIDI出力・ローカル保存
- `src/services/compose.ts` … `/api/compose` を叩き、失敗時はモックにフォールバック
- `src/services/mockCompose.ts` … GPT不使用のモック生成
- `src/lib/music.ts` … ノート変換/時間計算/MIDI生成ヘルパー
- `src/types.ts` … 曲データの型定義
- `server/index.js` … OpenAI を呼ぶ簡易API（Express + Zod）

## 今後の拡張アイデア
- OpenAI接続と応答JSONのバリデーション（最低限実装済み、強化余地あり）
- 五線譜表示（VexFlow など）と MusicXML/PDF 書き出し
- 伴奏トラック追加・MIDIインポート・提案履歴管理
- APIサーバー経由でのキー管理（フロントに鍵を置かない）
