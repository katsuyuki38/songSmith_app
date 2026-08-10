import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config({ path: '.env.local' })
dotenv.config()

const PORT = Number(process.env.VOCAL_API_PORT || 8790)
const VOCAL_ENGINE = (process.env.VOCAL_ENGINE || 'auto').toLowerCase()
const DIFFSINGER_URL = (process.env.DIFFSINGER_ENGINE_URL || '').replace(/\/$/, '')
const DEFAULT_SPEAKER = process.env.DIFFSINGER_SPEAKER || ''
const DEFAULT_LANG = process.env.DIFFSINGER_LANG || 'ja'
const VOICEVOX_URL = (process.env.VOICEVOX_ENGINE_URL || '').replace(/\/$/, '')
const VOICEVOX_SING_STYLE = Number(process.env.VOICEVOX_SING_STYLE || 6000)
const VOICEVOX_FRAME_STYLE = Number(process.env.VOICEVOX_FRAME_STYLE || 3001)
const ENGINE_TIMEOUT_MS = Number(process.env.DIFFSINGER_TIMEOUT_MS || 180000)

const noteSchema = z.object({
  midi: z.number().int().min(24).max(108),
  start: z.number().min(0),
  dur: z.number().positive(),
  lyric: z.string().default('あ'),
  pitch: z.number().min(-200).max(200).default(0),
  cons: z.number().min(0).max(300).default(55),
  dyn: z.number().min(0).max(150).default(85),
  vib: z.number().min(0).max(150).default(22),
  vibRate: z.number().min(0).max(15).optional(),
  vr: z.number().min(0).max(15).optional(),
  breath: z.number().min(0).max(100).default(18),
  scoop: z.number().min(-300).max(300).default(-35),
})

const renderSchema = z.object({
  bpm: z.number().min(40).max(240),
  notes: z.array(noteSchema).min(1),
  speaker: z.string().optional(),
  lang: z.string().optional(),
  title: z.string().optional(),
  voicevoxSingStyle: z.number().int().positive().optional(),
  voicevoxFrameStyle: z.number().int().positive().optional(),
})

const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const midiToNote = (midi) => `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}`
const round4 = (n) => Math.round(n * 10000) / 10000

const kanaMap = new Map(Object.entries({
  'あ':['a'],'い':['i'],'う':['u'],'え':['e'],'お':['o'],
  'か':['k','a'],'き':['k','i'],'く':['k','u'],'け':['k','e'],'こ':['k','o'],
  'が':['g','a'],'ぎ':['g','i'],'ぐ':['g','u'],'げ':['g','e'],'ご':['g','o'],
  'さ':['s','a'],'し':['sh','i'],'す':['s','u'],'せ':['s','e'],'そ':['s','o'],
  'ざ':['z','a'],'じ':['j','i'],'ず':['z','u'],'ぜ':['z','e'],'ぞ':['z','o'],
  'た':['t','a'],'ち':['ch','i'],'つ':['ts','u'],'て':['t','e'],'と':['t','o'],
  'だ':['d','a'],'ぢ':['j','i'],'づ':['z','u'],'で':['d','e'],'ど':['d','o'],
  'な':['n','a'],'に':['n','i'],'ぬ':['n','u'],'ね':['n','e'],'の':['n','o'],
  'は':['h','a'],'ひ':['h','i'],'ふ':['f','u'],'へ':['h','e'],'ほ':['h','o'],
  'ば':['b','a'],'び':['b','i'],'ぶ':['b','u'],'べ':['b','e'],'ぼ':['b','o'],
  'ぱ':['p','a'],'ぴ':['p','i'],'ぷ':['p','u'],'ぺ':['p','e'],'ぽ':['p','o'],
  'ま':['m','a'],'み':['m','i'],'む':['m','u'],'め':['m','e'],'も':['m','o'],
  'や':['y','a'],'ゆ':['y','u'],'よ':['y','o'],
  'ら':['r','a'],'り':['r','i'],'る':['r','u'],'れ':['r','e'],'ろ':['r','o'],
  'わ':['w','a'],'を':['o'],'ん':['N'],'っ':['cl'],
  'きゃ':['ky','a'],'きゅ':['ky','u'],'きょ':['ky','o'],
  'ぎゃ':['gy','a'],'ぎゅ':['gy','u'],'ぎょ':['gy','o'],
  'しゃ':['sh','a'],'しゅ':['sh','u'],'しょ':['sh','o'],
  'じゃ':['j','a'],'じゅ':['j','u'],'じょ':['j','o'],
  'ちゃ':['ch','a'],'ちゅ':['ch','u'],'ちょ':['ch','o'],
  'にゃ':['ny','a'],'にゅ':['ny','u'],'にょ':['ny','o'],
  'ひゃ':['hy','a'],'ひゅ':['hy','u'],'ひょ':['hy','o'],
  'びゃ':['by','a'],'びゅ':['by','u'],'びょ':['by','o'],
  'ぴゃ':['py','a'],'ぴゅ':['py','u'],'ぴょ':['py','o'],
  'みゃ':['my','a'],'みゅ':['my','u'],'みょ':['my','o'],
  'りゃ':['ry','a'],'りゅ':['ry','u'],'りょ':['ry','o'],
  'ふぁ':['f','a'],'ふぃ':['f','i'],'ふぇ':['f','e'],'ふぉ':['f','o'],
  'てぃ':['t','i'],'でぃ':['d','i'],'とぅ':['t','u'],'どぅ':['d','u'],
  'うぃ':['w','i'],'うぇ':['w','e'],'うぉ':['w','o'],
}))

const toHiragana = (text) => [...text].map((c) => {
  const code = c.charCodeAt(0)
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : c
}).join('')

const normalizeMora = (text) => toHiragana(String(text || 'あ').trim()).replace(/ー/g, '') || 'あ'

const moraToPhonemes = (mora) => {
  const normalized = normalizeMora(mora)
  if (kanaMap.has(normalized)) return kanaMap.get(normalized)
  if (normalized.length > 1 && kanaMap.has(normalized.slice(-1))) return kanaMap.get(normalized.slice(-1))
  return ['a']
}

const allocatePhonemeDurations = (phonemes, noteDuration, consonantLeadMs) => {
  if (phonemes.length <= 1) return [round4(noteDuration)]
  const consonant = Math.min(noteDuration * 0.42, Math.max(0.015, consonantLeadMs / 1000))
  const remainder = Math.max(0.02, noteDuration - consonant)
  const tailCount = phonemes.length - 1
  return [round4(consonant), ...Array(tailCount).fill(round4(remainder / tailCount))]
}

export const buildDiffSingerProject = ({ bpm, notes }) => {
  const secPerBeat = 60 / bpm
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi)
  const segments = []
  let previousEnd = 0

  for (const n of sorted) {
    const startSec = n.start * secPerBeat
    const durationSec = Math.max(0.03, n.dur * secPerBeat)
    if (startSec > previousEnd + 0.01) {
      const restDur = round4(startSec - previousEnd)
      segments.push({ offset: round4(previousEnd), text: 'SP', ph_seq: 'SP', ph_dur: String(restDur), ph_num: '1', note_seq: 'rest', note_dur: String(restDur), note_slur: '0' })
    }
    const phonemes = moraToPhonemes(n.lyric)
    const phDur = allocatePhonemeDurations(phonemes, durationSec, n.cons)
    segments.push({
      offset: round4(startSec), text: normalizeMora(n.lyric), ph_seq: phonemes.join(' '), ph_dur: phDur.join(' '), ph_num: String(phonemes.length), note_seq: midiToNote(n.midi), note_dur: String(round4(durationSec)), note_slur: '0',
      songsmith: { pitch_cents: n.pitch, dynamics: n.dyn, vibrato_cents: n.vib, vibrato_hz: n.vibRate ?? n.vr ?? 5.4, breathiness: n.breath, scoop_cents: n.scoop, consonant_lead_ms: n.cons },
    })
    previousEnd = Math.max(previousEnd, startSec + durationSec)
  }
  return segments
}

const getVoicevoxFrameRate = async () => {
  try {
    const r = await fetch(`${VOICEVOX_URL}/engine_manifest`)
    if (!r.ok) return 93.75
    const j = await r.json()
    return Number(j.frame_rate || 93.75)
  } catch {
    return 93.75
  }
}

const buildVoicevoxScore = ({ bpm, notes }, frameRate) => {
  const secPerBeat = 60 / bpm
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi)
  const score = [{ key: null, frame_length: 1, lyric: '' }]
  let previousEndSec = 0
  for (const n of sorted) {
    const startSec = n.start * secPerBeat
    const durationSec = Math.max(1 / frameRate, n.dur * secPerBeat)
    const gap = startSec - previousEndSec
    if (gap > 1 / frameRate) score.push({ key: null, frame_length: Math.max(1, Math.round(gap * frameRate)), lyric: '' })
    score.push({ key: n.midi, frame_length: Math.max(1, Math.round(durationSec * frameRate)), lyric: normalizeMora(n.lyric) })
    previousEndSec = Math.max(previousEndSec, startSec + durationSec)
  }
  score.push({ key: null, frame_length: Math.max(1, Math.round(frameRate * 0.16)), lyric: '' })
  return { notes: score }
}

const renderWithVoicevox = async (data) => {
  if (!VOICEVOX_URL) throw new Error('VOICEVOX_ENGINE_URL is not configured')
  const frameRate = await getVoicevoxFrameRate()
  const score = buildVoicevoxScore(data, frameRate)
  const singStyle = data.voicevoxSingStyle || VOICEVOX_SING_STYLE
  const frameStyle = data.voicevoxFrameStyle || VOICEVOX_FRAME_STYLE
  const q = await fetch(`${VOICEVOX_URL}/sing_frame_audio_query?speaker=${encodeURIComponent(singStyle)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(score) })
  if (!q.ok) throw new Error(`VOICEVOX sing_frame_audio_query failed (${q.status}): ${await q.text()}`)
  const query = await q.json()
  const w = await fetch(`${VOICEVOX_URL}/frame_synthesis?speaker=${encodeURIComponent(frameStyle)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(query) })
  if (!w.ok) throw new Error(`VOICEVOX frame_synthesis failed (${w.status}): ${await w.text()}`)
  return Buffer.from(await w.arrayBuffer())
}

const renderWithDiffSinger = async (data) => {
  if (!DIFFSINGER_URL) throw new Error('DIFFSINGER_ENGINE_URL is not configured')
  const project = buildDiffSingerProject(data)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ENGINE_TIMEOUT_MS)
  try {
    const upstream = await fetch(`${DIFFSINGER_URL}/render`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project, speaker: data.speaker || DEFAULT_SPEAKER || null, lang: data.lang || DEFAULT_LANG, title: data.title || 'songsmith-render' }), signal: controller.signal })
    if (!upstream.ok) throw new Error(`DiffSinger engine failed (${upstream.status}): ${await upstream.text()}`)
    return Buffer.from(await upstream.arrayBuffer())
  } finally {
    clearTimeout(timeout)
  }
}

const resolveEngine = () => {
  if (VOCAL_ENGINE === 'voicevox') return 'voicevox'
  if (VOCAL_ENGINE === 'diffsinger') return 'diffsinger'
  if (VOICEVOX_URL) return 'voicevox'
  if (DIFFSINGER_URL) return 'diffsinger'
  return null
}

const app = express()
app.use(cors())
app.use(express.json({ limit: '4mb' }))

app.get('/health', async (_req, res) => {
  let voicevoxReachable = false
  let voicevoxVersion = null
  if (VOICEVOX_URL) {
    try {
      const r = await fetch(`${VOICEVOX_URL}/version`, { signal: AbortSignal.timeout(2500) })
      if (r.ok) { voicevoxReachable = true; voicevoxVersion = await r.json().catch(async () => await r.text()) }
    } catch {}
  }
  res.json({ ok: true, activeEngine: resolveEngine(), vocalEngineMode: VOCAL_ENGINE, diffsingerConfigured: Boolean(DIFFSINGER_URL), voicevoxConfigured: Boolean(VOICEVOX_URL), voicevoxReachable, voicevoxVersion, voicevoxSingStyle: VOICEVOX_SING_STYLE, voicevoxFrameStyle: VOICEVOX_FRAME_STYLE, speaker: DEFAULT_SPEAKER || null, lang: DEFAULT_LANG })
})

app.get('/voices', async (_req, res) => {
  if (!VOICEVOX_URL) return res.status(503).json({ error: 'voicevox_not_configured' })
  try {
    const r = await fetch(`${VOICEVOX_URL}/singers`)
    if (!r.ok) return res.status(502).json({ error: 'voicevox_singers_failed', detail: await r.text() })
    return res.json(await r.json())
  } catch (error) {
    return res.status(502).json({ error: 'voicevox_unreachable', message: error?.message })
  }
})

app.post('/vocal/ds', (req, res) => {
  const parsed = renderSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request', detail: parsed.error.format() })
  return res.json({ format: 'DiffSinger DS', project: buildDiffSingerProject(parsed.data), speaker: parsed.data.speaker || DEFAULT_SPEAKER || null, lang: parsed.data.lang || DEFAULT_LANG })
})

app.post('/vocal/render', async (req, res) => {
  const parsed = renderSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request', detail: parsed.error.format() })
  const engine = resolveEngine()
  if (!engine) return res.status(503).json({ error: 'vocal_engine_not_configured', message: 'Set VOICEVOX_ENGINE_URL or DIFFSINGER_ENGINE_URL.' })
  try {
    const audio = engine === 'voicevox' ? await renderWithVoicevox(parsed.data) : await renderWithDiffSinger(parsed.data)
    res.setHeader('content-type', 'audio/wav')
    res.setHeader('content-length', String(audio.length))
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-songsmith-vocal-engine', engine)
    return res.end(audio)
  } catch (error) {
    return res.status(502).json({ error: `${engine}_render_failed`, message: error?.message })
  }
})

app.listen(PORT, () => {
  console.log(`Vocal API listening on http://localhost:${PORT}`)
  console.log(`Active engine: ${resolveEngine() || '(not configured)'}`)
})
