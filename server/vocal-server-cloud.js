import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config({ path: '.env.local' })
dotenv.config()

const PORT = Number(process.env.PORT || process.env.VOCAL_API_PORT || 8790)
const HOST = process.env.HOST || '::'
const VOICEVOX_URL = (process.env.VOICEVOX_ENGINE_URL || '').replace(/\/$/, '')
const API_KEY = process.env.VOCAL_API_KEY || ''
const REQUEST_TIMEOUT_MS = Number(process.env.VOICEVOX_TIMEOUT_MS || 180000)
const MAX_NOTES = Number(process.env.VOCAL_MAX_NOTES || 512)
const configuredSingStyle = Number(process.env.VOICEVOX_SING_STYLE || 0)
const configuredFrameStyle = Number(process.env.VOICEVOX_FRAME_STYLE || 0)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://test.noinoi.xyz')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)

const noteSchema = z.object({
  midi: z.number().int().min(24).max(108),
  start: z.number().min(0).max(4096),
  dur: z.number().positive().max(64),
  lyric: z.string().min(1).max(8).default('あ'),
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
  notes: z.array(noteSchema).min(1).max(MAX_NOTES),
  title: z.string().max(120).optional(),
  voicevoxSingStyle: z.number().int().positive().optional(),
  voicevoxFrameStyle: z.number().int().positive().optional(),
})

const toHiragana = (text) => [...String(text || '')].map((char) => {
  const code = char.charCodeAt(0)
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : char
}).join('')

const normalizeMora = (value) => {
  const normalized = toHiragana(value)
    .trim()
    .replace(/[\s、。,.!！?？「」『』（）()・…ー]/g, '')
  return normalized || 'あ'
}

const withTimeout = async (url, options = {}) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

const getFrameRate = async () => {
  const response = await withTimeout(`${VOICEVOX_URL}/engine_manifest`)
  if (!response.ok) return 93.75
  const manifest = await response.json()
  return Number(manifest.frame_rate || 93.75)
}

const flattenSingerStyles = (singers) => (Array.isArray(singers) ? singers : []).flatMap((singer) =>
  (Array.isArray(singer.styles) ? singer.styles : []).map((style) => ({
    singer: singer.name || singer.speaker_name || '',
    name: style.name || '',
    id: Number(style.id ?? style.style_id),
    type: style.type || style.style_type || '',
  })),
)

const resolveStyles = async (requestedSingStyle, requestedFrameStyle) => {
  if (requestedSingStyle && requestedFrameStyle) {
    return { singStyle: requestedSingStyle, frameStyle: requestedFrameStyle, styles: [] }
  }

  const response = await withTimeout(`${VOICEVOX_URL}/singers`)
  if (!response.ok) {
    throw new Error(`VOICEVOX /singers failed (${response.status}): ${await response.text()}`)
  }
  const singers = await response.json()
  const styles = flattenSingerStyles(singers)
  const sing = styles.find((style) => ['sing', 'singing_teacher'].includes(style.type))
  const frame = styles.find((style) => style.type === 'frame_decode')
  const singStyle = requestedSingStyle || configuredSingStyle || sing?.id
  const frameStyle = requestedFrameStyle || configuredFrameStyle || frame?.id

  if (!singStyle || !frameStyle) {
    throw new Error('VOICEVOXの歌唱スタイルを自動検出できませんでした。/singersの内容を確認してください。')
  }
  return { singStyle, frameStyle, styles }
}

const buildScore = ({ bpm, notes }, frameRate) => {
  const secPerBeat = 60 / bpm
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi)
  const score = [{ key: null, frame_length: Math.max(1, Math.round(frameRate * 0.08)), lyric: '' }]
  let previousEndSec = 0

  for (const note of sorted) {
    const startSec = note.start * secPerBeat
    const durationSec = Math.max(1 / frameRate, note.dur * secPerBeat)
    const gapSec = startSec - previousEndSec
    if (gapSec > 1 / frameRate) {
      score.push({
        key: null,
        frame_length: Math.max(1, Math.round(gapSec * frameRate)),
        lyric: '',
      })
    }
    score.push({
      key: note.midi,
      frame_length: Math.max(1, Math.round(durationSec * frameRate)),
      lyric: normalizeMora(note.lyric),
    })
    previousEndSec = Math.max(previousEndSec, startSec + durationSec)
  }

  score.push({ key: null, frame_length: Math.max(1, Math.round(frameRate * 0.16)), lyric: '' })
  return { notes: score }
}

const renderVoicevox = async (data) => {
  if (!VOICEVOX_URL) throw new Error('VOICEVOX_ENGINE_URL is not configured')
  const [frameRate, styleInfo] = await Promise.all([
    getFrameRate(),
    resolveStyles(
      data.voicevoxSingStyle || configuredSingStyle,
      data.voicevoxFrameStyle || configuredFrameStyle,
    ),
  ])
  const score = buildScore(data, frameRate)
  const queryResponse = await withTimeout(
    `${VOICEVOX_URL}/sing_frame_audio_query?speaker=${encodeURIComponent(styleInfo.singStyle)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(score),
    },
  )
  if (!queryResponse.ok) {
    throw new Error(`VOICEVOX sing_frame_audio_query failed (${queryResponse.status}): ${await queryResponse.text()}`)
  }
  const query = await queryResponse.json()
  const synthesisResponse = await withTimeout(
    `${VOICEVOX_URL}/frame_synthesis?speaker=${encodeURIComponent(styleInfo.frameStyle)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(query),
    },
  )
  if (!synthesisResponse.ok) {
    throw new Error(`VOICEVOX frame_synthesis failed (${synthesisResponse.status}): ${await synthesisResponse.text()}`)
  }
  return {
    audio: Buffer.from(await synthesisResponse.arrayBuffer()),
    singStyle: styleInfo.singStyle,
    frameStyle: styleInfo.frameStyle,
  }
}

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true)
    }
    return callback(new Error('Origin is not allowed by CORS'))
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['content-type', 'x-api-key'],
}))
app.use(express.json({ limit: '2mb' }))

const requireApiKey = (req, res, next) => {
  if (!API_KEY) return next()
  const supplied = req.get('x-api-key') || ''
  if (supplied !== API_KEY) return res.status(401).json({ error: 'unauthorized' })
  return next()
}

app.get('/', (_req, res) => res.json({
  name: 'SongSmith Vocal API',
  ok: true,
  docs: ['/health', '/voices', 'POST /vocal/render'],
}))

app.get('/health', async (_req, res) => {
  if (!VOICEVOX_URL) {
    return res.status(503).json({ ok: false, activeEngine: null, message: 'VOICEVOX_ENGINE_URL is not configured' })
  }
  try {
    const response = await withTimeout(`${VOICEVOX_URL}/version`)
    const version = response.ok ? await response.json().catch(async () => await response.text()) : null
    const styles = await resolveStyles(configuredSingStyle, configuredFrameStyle)
    return res.json({
      ok: response.ok,
      activeEngine: 'voicevox',
      voicevoxReachable: response.ok,
      voicevoxVersion: version,
      voicevoxSingStyle: styles.singStyle,
      voicevoxFrameStyle: styles.frameStyle,
      apiKeyRequired: Boolean(API_KEY),
      allowedOrigins,
    })
  } catch (error) {
    return res.status(503).json({ ok: false, activeEngine: 'voicevox', voicevoxReachable: false, message: error?.message })
  }
})

app.get('/voices', requireApiKey, async (_req, res) => {
  try {
    const response = await withTimeout(`${VOICEVOX_URL}/singers`)
    if (!response.ok) return res.status(502).json({ error: 'voicevox_singers_failed', detail: await response.text() })
    const singers = await response.json()
    return res.json({ singers, styles: flattenSingerStyles(singers) })
  } catch (error) {
    return res.status(502).json({ error: 'voicevox_unreachable', message: error?.message })
  }
})

app.post('/vocal/render', requireApiKey, async (req, res) => {
  const parsed = renderSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_request', detail: parsed.error.format() })
  }
  try {
    const result = await renderVoicevox(parsed.data)
    res.setHeader('content-type', 'audio/wav')
    res.setHeader('content-length', String(result.audio.length))
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-songsmith-vocal-engine', 'voicevox')
    res.setHeader('x-songsmith-sing-style', String(result.singStyle))
    res.setHeader('x-songsmith-frame-style', String(result.frameStyle))
    return res.end(result.audio)
  } catch (error) {
    return res.status(502).json({ error: 'voicevox_render_failed', message: error?.message })
  }
})

app.use((error, _req, res, _next) => {
  if (error?.message === 'Origin is not allowed by CORS') {
    return res.status(403).json({ error: 'cors_origin_denied' })
  }
  console.error(error)
  return res.status(500).json({ error: 'internal_error' })
})

app.listen(PORT, HOST, () => {
  console.log(`SongSmith Vocal API listening on [${HOST}]:${PORT}`)
  console.log(`VOICEVOX URL: ${VOICEVOX_URL || '(not configured)'}`)
  console.log(`API key required: ${Boolean(API_KEY)}`)
})
