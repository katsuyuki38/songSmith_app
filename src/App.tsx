import { useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import { compose } from './services/compose'
import {
  beatsToSeconds,
  buildMidiFile,
  getEndBeat,
  lengthToBeats,
  midiToNoteName,
  noteToMidi,
  shiftNote,
} from './lib/music'
import type { ComposeRequest, SongIdea } from './types'
import './index.css'

const STORAGE_KEY = 'songsmith-projects'

const defaultForm = {
  prompt: '明るくて切ないJ-POPのサビを作って',
  key: 'C',
  mode: 'major',
  bpm: 110,
  section: 'サビ',
  tags: '明るい,切ない,J-POP',
}

const lengthOptions = ['1/8', '1/4', '1/2', '1', '2']

function App() {
  const [form, setForm] = useState(defaultForm)
  const [ideas, setIdeas] = useState<SongIdea[]>([])
  const [selectedIdea, setSelectedIdea] = useState<SongIdea | null>(null)
  const [saved, setSaved] = useState<SongIdea[]>([])
  const [title, setTitle] = useState('Untitled Idea')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const synthRef = useRef<Tone.PolySynth | null>(null)

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    try {
      const parsed: SongIdea[] = JSON.parse(raw)
      setSaved(parsed)
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    if (saved.length === 0) {
      localStorage.removeItem(STORAGE_KEY)
      return
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  }, [saved])

  const handleCompose = async () => {
    const payload: ComposeRequest = {
      prompt: form.prompt.trim(),
      key: `${form.key}${form.mode === 'major' ? '' : 'm'}`,
      bpm: form.bpm,
      section: form.section,
      moodTags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    }

    setLoading(true)
    setError(null)
    try {
      const response = await compose(payload)
      const normalized = response.variants.map((v) => {
        if (v.melody && v.melody.length > 0) return v
        if (v.tracks && v.tracks.length > 0) {
          const lead = v.tracks.find((t) => t.role === 'lead') || v.tracks[0]
          return { ...v, melody: lead.notes }
        }
        return v
      })
      setIdeas(normalized)
      const first = normalized[0]
      setSelectedIdea(first)
      setTitle(first.title)
    } catch (e) {
      console.error('compose failed', e)
      setError('AIからの提案取得に失敗しました（モック）。')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectIdea = (idea: SongIdea) => {
    setSelectedIdea(idea)
    setTitle(idea.title)
  }

  const handleSave = () => {
    if (!selectedIdea) return
    const stamped: SongIdea = {
      ...selectedIdea,
      title,
      updatedAt: new Date().toISOString(),
    }
    setSaved((prev) => {
      const existing = prev.filter((p) => p.id !== stamped.id)
      return [...existing, stamped]
    })
  }

  const handleDeleteSaved = (id: string) => {
    setSaved((prev) => prev.filter((p) => p.id !== id))
    if (selectedIdea?.id === id) {
      setSelectedIdea(null)
    }
  }

  const handlePlay = async () => {
    if (!selectedIdea) return
    await Tone.start()
    synthRef.current?.dispose()
    const synth = new Tone.PolySynth(Tone.Synth).toDestination()
    synthRef.current = synth
    const secPerBeat = 60 / selectedIdea.bpm
    const now = Tone.now()
    const playNotes =
      selectedIdea.tracks && selectedIdea.tracks.length > 0
        ? selectedIdea.tracks.flatMap((t) => t.notes)
        : selectedIdea.melody
    playNotes.forEach((note) => {
      const start = now + (note.beat - 1) * secPerBeat
      const duration = lengthToBeats(note.length) * secPerBeat
      synth.triggerAttackRelease(note.note, duration, start)
    })
    setIsPlaying(true)
    const stopAfter = beatsToSeconds(getEndBeat(selectedIdea.melody), selectedIdea.bpm)
    setTimeout(() => {
      setIsPlaying(false)
      synthRef.current?.dispose()
      synthRef.current = null
    }, stopAfter * 1000)
  }

  const handleStop = () => {
    synthRef.current?.releaseAll()
    synthRef.current?.dispose()
    synthRef.current = null
    setIsPlaying(false)
  }

  const handleExportMidi = () => {
    if (!selectedIdea) return
    const bytes = new Uint8Array(
      buildMidiFile(selectedIdea.melody, selectedIdea.bpm, selectedIdea.tracks),
    )
    const blob = new Blob([bytes], { type: 'audio/midi' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title || 'idea'}.mid`
    a.click()
    URL.revokeObjectURL(url)
  }

  const updateNotePitch = (index: number, delta: number) => {
    if (!selectedIdea) return
    const melody = [...selectedIdea.melody]
    melody[index] = { ...melody[index], note: shiftNote(melody[index].note, delta) }
    setSelectedIdea({ ...selectedIdea, melody })
  }

  const updateNoteLength = (index: number, length: string) => {
    if (!selectedIdea) return
    const melody = [...selectedIdea.melody]
    melody[index] = { ...melody[index], length }
    setSelectedIdea({ ...selectedIdea, melody })
  }

  const totalBeats = useMemo(
    () => (selectedIdea ? getEndBeat(selectedIdea.melody) : 0),
    [selectedIdea],
  )

  return (
    <div className="min-h-screen px-6 pb-16 text-slate-100">
      <header className="flex flex-col gap-2 py-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.25em] text-cyan-200">SongSmith AI</p>
          <h1 className="mt-2 text-3xl font-semibold text-white lg:text-4xl">
            AI作曲支援 Web アプリ プロトタイプ
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            GPT提案（8小節シード→最大128小節まで拡張）→ ピアノロール確認 → 再生 &amp; MIDI書き出し。UI/データ構造の縦切り版。
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm text-slate-400">
          <span className="rounded-full border border-cyan-500/50 px-3 py-1 text-cyan-200">
            v0.2 GPT live
          </span>
          <span className="rounded-full border border-white/10 px-3 py-1">
            ブラウザ完結・ローカル保存
          </span>
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-card/70 p-5 shadow-glow backdrop-blur lg:col-span-2">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-white">課題入力・条件</h2>
              <p className="text-sm text-slate-400">
                テキスト指示 + キー/BPM/セクション/タグを渡して AI から3案を受け取ります（GPT生成→ロング尺へ自動拡張）。
              </p>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 hover:border-white/30"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    prompt: '失恋バラードのAメロ。BPM 88、キーはGメジャーで切なめに。',
                    bpm: 88,
                    key: 'G',
                    mode: 'major',
                    section: 'Aメロ',
                    tags: '切ない,バラード',
                  }))
                }
              >
                プリセット1
              </button>
              <button
                className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 hover:border-white/30"
                onClick={() =>
                  setForm((prev) => ({
                    ...prev,
                    prompt: '夜っぽいシティポップのサビ。BPM 105、キーはE♭メジャーで都会的に。',
                    bpm: 105,
                    key: 'Eb',
                    mode: 'major',
                    section: 'サビ',
                    tags: 'シティポップ,夜,おしゃれ',
                  }))
                }
              >
                プリセット2
              </button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm text-slate-300">
              プロンプト
              <textarea
                className="min-h-[140px] rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-base text-white outline-none ring-0 focus:border-cyan-400/70"
                value={form.prompt}
                onChange={(e) => setForm((prev) => ({ ...prev, prompt: e.target.value }))}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                キー
                <div className="flex gap-2">
                  <input
                    className="w-24 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-cyan-400/70"
                    value={form.key}
                    onChange={(e) => setForm((prev) => ({ ...prev, key: e.target.value }))}
                  />
                  <select
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-cyan-400/70"
                    value={form.mode}
                    onChange={(e) => setForm((prev) => ({ ...prev, mode: e.target.value }))}
                  >
                    <option value="major">Major</option>
                    <option value="minor">Minor</option>
                  </select>
                </div>
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                BPM
                <input
                  type="number"
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-cyan-400/70"
                  value={form.bpm}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, bpm: Number(e.target.value) || 0 }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-300">
                セクション
                <input
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-cyan-400/70"
                  value={form.section}
                  onChange={(e) => setForm((prev) => ({ ...prev, section: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-300 sm:col-span-2">
                タグ（カンマ区切り）
                <input
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-cyan-400/70"
                  value={form.tags}
                  onChange={(e) => setForm((prev) => ({ ...prev, tags: e.target.value }))}
                />
              </label>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-sm text-slate-400">
              GPT API 接続想定。レスポンスはコード進行/メロディ/構成を JSON で保持し複数案提示。
            </div>
            <button
              onClick={handleCompose}
              disabled={loading || !form.prompt.trim()}
              className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-900 shadow-glow transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? '生成中…' : 'AI に作曲案をリクエスト'}
            </button>
          </div>
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        </div>

        <div className="rounded-2xl border border-white/10 bg-card/80 p-5 shadow-glow backdrop-blur">
          <h3 className="text-lg font-semibold text-white">プロジェクト保存</h3>
          <p className="mt-1 text-sm text-slate-400">
            ローカルストレージに保存します。ブラウザを変えると引き継がれません。
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm text-slate-300">
              タイトル
              <input
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white outline-none focus:border-cyan-400/70"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Untitled Idea"
              />
            </label>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={!selectedIdea}
                className="flex-1 rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                保存
              </button>
              <button
                onClick={handleExportMidi}
                disabled={!selectedIdea}
                className="flex-1 rounded-lg border border-cyan-400/60 px-3 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                MIDI書き出し
              </button>
            </div>
          </div>

          <div className="mt-5 border-t border-white/10 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-200">保存済み</p>
              <span className="text-xs text-slate-500">{saved.length}件</span>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {saved.length === 0 && (
                <p className="text-sm text-slate-500">まだ保存がありません。</p>
              )}
              {saved.map((project) => (
                <div
                  key={project.id}
                  className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-semibold text-white">{project.title}</p>
                    <p className="text-xs text-slate-500">
                      {project.key.root} {project.key.mode} / BPM {project.bpm}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="rounded-md bg-white/10 px-2 py-1 text-xs text-slate-200 hover:bg-white/20"
                      onClick={() => handleSelectIdea(project)}
                    >
                      ロード
                    </button>
                    <button
                      className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-200 hover:bg-red-500/10"
                      onClick={() => handleDeleteSaved(project.id)}
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-card/70 p-5 shadow-glow lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-semibold text-white">AI提案</h3>
              <p className="text-sm text-slate-400">GPT生成 3案まで並列表示します。</p>
            </div>
            <span className="rounded-full bg-white/5 px-3 py-1 text-xs text-slate-300">
              {ideas.length}案
            </span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {ideas.map((idea) => (
              <button
                key={idea.id}
                onClick={() => handleSelectIdea(idea)}
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  selectedIdea?.id === idea.id
                    ? 'border-cyan-400/70 bg-cyan-500/10 shadow-glow'
                    : 'border-white/10 bg-white/5 hover:border-white/20'
                }`}
              >
                <p className="text-sm font-semibold text-white">{idea.title}</p>
                <p className="text-xs text-slate-400">
                  {idea.key.root} {idea.key.mode} / BPM {idea.bpm} / {idea.sections[0]?.name}
                </p>
                <p className="mt-1 text-xs text-slate-500 line-clamp-2">
                  {idea.tags.join(', ')}
                </p>
              </button>
            ))}
            {ideas.length === 0 && (
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-500">
                まだ提案がありません。左のフォームから生成してください。
              </div>
            )}
          </div>

          {selectedIdea && (
            <div className="mt-6 rounded-2xl border border-white/10 bg-surface/70 p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm uppercase tracking-[0.2em] text-cyan-200">Preview</p>
                  <h4 className="text-xl font-semibold text-white">{title}</h4>
                  <p className="text-sm text-slate-400">
                    {selectedIdea.key.root} {selectedIdea.key.mode} / BPM {selectedIdea.bpm} /{' '}
                    {selectedIdea.sections.map((s) => s.name).join('・')}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handlePlay}
                    className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-900 shadow-glow hover:bg-cyan-400"
                  >
                    再生 {isPlaying ? '中…' : ''}
                  </button>
                  <button
                    onClick={handleStop}
                    className="rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold text-white hover:border-white/40"
                  >
                    停止
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <PianoRoll melody={selectedIdea.melody} totalBeats={totalBeats} />
              </div>

              <div className="mt-4 space-y-2">
                <p className="text-sm font-semibold text-white">ノート編集</p>
                {selectedIdea.melody.map((note, idx) => (
                  <div
                    key={`${note.note}-${idx}-${note.beat}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                  >
                    <span className="text-xs font-semibold text-cyan-200">Beat {note.beat}</span>
                    <span className="rounded-md bg-white/10 px-2 py-1 text-sm font-semibold text-white">
                      {note.note}
                    </span>
                    <div className="flex gap-1">
                      <button
                        className="rounded-md border border-white/20 px-2 py-1 text-xs text-white hover:border-white/40"
                        onClick={() => updateNotePitch(idx, 1)}
                      >
                        ↑
                      </button>
                      <button
                        className="rounded-md border border-white/20 px-2 py-1 text-xs text-white hover:border-white/40"
                        onClick={() => updateNotePitch(idx, -1)}
                      >
                        ↓
                      </button>
                    </div>
                    <select
                      className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm text-white outline-none focus:border-cyan-400/70"
                      value={note.length}
                      onChange={(e) => updateNoteLength(idx, e.target.value)}
                    >
                      {lengthOptions.map((len) => (
                        <option key={len} value={len}>
                          長さ {len}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-card/70 p-5 shadow-glow">
          <h4 className="text-lg font-semibold text-white">状態メモ</h4>
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            <li>・GPTで8小節シードを生成し、サーバーで最大128小節に拡張して3案提示。</li>
            <li>・楽曲データは JSON（melody/chords/sections/tracks/lyrics）。MIDI出力は @tonejs/midi。</li>
            <li>・保存先は localStorage。Git には含めない。</li>
            <li>・UIは Tailwind。音源は Tone.js の簡易シンセ。</li>
          </ul>
          <div className="mt-4 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-xs text-slate-400">
            次ステップ: OpenAI 接続 / バリデーション / 五線譜 (VexFlow) / 伴奏トラック追加 / APIサーバー側でキー管理。
          </div>
        </div>
      </section>
    </div>
  )
}

function PianoRoll({ melody, totalBeats }: { melody: SongIdea['melody']; totalBeats: number }) {
  const maxMidi = 76 // E5
  const minMidi = 48 // C3
  const pxPerBeat = 42
  const laneHeight = 32
  const lanes = useMemo(
    () =>
      Array.from({ length: maxMidi - minMidi + 1 }, (_, idx) =>
        midiToNoteName(maxMidi - idx),
      ),
    [],
  )
  return (
    <div
      className="relative mt-2 overflow-hidden rounded-xl border border-white/10 bg-slate-950/60 p-3"
      style={{ height: lanes.length * laneHeight + 20 }}
    >
      <div className="grid" style={{ gridTemplateColumns: `repeat(${totalBeats || 1}, 1fr)` }}>
        {Array.from({ length: totalBeats || 1 }).map((_, idx) => (
          <div
            key={idx}
            className="h-0.5 bg-white/5"
            style={{ gridColumn: idx + 1, gridRow: '1 / -1' }}
          />
        ))}
      </div>
      <div className="relative mt-2 space-y-2">
        {lanes.map((lane) => (
          <div key={lane} className="relative h-8 border-b border-white/5 last:border-none">
            <span className="absolute left-0 top-1 text-[10px] uppercase tracking-[0.2em] text-slate-500">
              {lane}
            </span>
          </div>
        ))}
        {melody.map((note, idx) => {
          const width = Math.max(lengthToBeats(note.length), 0.25) * pxPerBeat
          const left = (note.beat - 1) * pxPerBeat
          const midi = noteToMidi(note.note)
          const clampedMidi = Math.min(Math.max(midi, minMidi), maxMidi)
          const laneIndex = maxMidi - clampedMidi
          const top = laneIndex * laneHeight + 6
          return (
            <div
              key={`${note.note}-${idx}-${note.beat}`}
              className="absolute rounded-md bg-cyan-400/80 text-[10px] font-semibold text-slate-900 shadow-glow"
              style={{ width, left, top, padding: '6px 8px' }}
            >
              {note.note} · {note.length}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default App
