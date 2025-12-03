# SongSmith AI - NOTES

## Purpose
- 音楽理論に詳しくないユーザーでも、AIのサポートでポップス作曲を進められるWebアプリ。
- GPTでメロディ/コード/構成/歌詞案の提案・添削。MIDI書き出しを提供。

## Scope / Constraints
- GPT API 以外の有償サービスは不使用。
- ブラウザ完結（インストール不要）。小規模開発を想定。
- データは原則ローカル保存（localStorage/IndexedDB）。

## Requirements (snapshot)
- 入力: テキスト指示 + 条件フォーム（キー/BPM/セクション/タグ）。
- GPT応答: コード進行/メロディ/構成をJSONで受け取り、複数案提示。
- 再生/編集: ピアノロール簡易表示、再生/停止/ループ、音高・長さ編集。
- MIDI: JSON→MIDI生成とダウンロード。再生はブラウザ内。
- 保存: プロジェクトをローカルに保存/ロード/削除。
- 将来: 五線譜表示 (VexFlow等)、歌詞サポート、ボーカル用データ出力、MusicXML/PDF。

## Milestones (draft)
- v0.1: GPTとテキストやり取り→JSON受領、ピアノロール簡易表示、MIDI DL。
- v0.5: UI整備（条件フォーム/履歴）、保存安定化。
- v1.0: 五線譜表示、ボーカル用データ出力、簡易チュートリアル。

## Open Questions
- フレームワーク: Next.js vs Vite (現状: Vite + React + TS + Tailwindを想定)。
- MIDIライブラリ: tonejs/midi vs scribbletune。まずは tonejs/midi を試す。
- 楽譜: VexFlow vs OpenSheetMusicDisplay (要評価)。

## Links / Commands
- 開発: `npm run dev`
- Lint: `npm run lint`
- Build: `npm run build`

## API Keys
- `OPENAI_API_KEY` は .env.local に保存。`OPENAI_MODEL` は任意。
