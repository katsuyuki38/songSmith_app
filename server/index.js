import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { OpenAI } from 'openai'

dotenv.config({ path: '.env.local' })
dotenv.config()

const PORT = process.env.API_PORT || 8788
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const composeRequestSchema = z.object({
  prompt: z.string().min(1),
  key: z.string().min(1),
  bpm: z.number().min(40).max(240),
  section: z.string().min(1),
  moodTags: z.array(z.string()).default([]),
})

const lengthValues = ['1/8', '1/4', '1/2', '1', '2']
const lengthToBeats = {
  '1/8': 0.5,
  '1/4': 1,
  '1/2': 2,
  '1': 4,
  '2': 8,
}

const melodyNoteSchema = z.object({
  beat: z.number().min(1),
  note: z.string().min(2),
  length: z.enum(lengthValues),
})

const chordSchema = z.object({
  bar: z.number().min(1),
  chord: z.string().min(1),
})

const sectionSchema = z.object({
  name: z.string().min(1),
  bars: z.number().min(1),
  pattern: z.string().min(1),
})

const aiVariantSchema = z.object({
  title: z.string().min(1),
  melody: z.array(melodyNoteSchema).min(1),
  chords: z.array(chordSchema).min(1),
  sections: z.array(sectionSchema).min(1),
  tags: z.array(z.string()).default([]),
  tracks: z
    .array(
      z.object({
        id: z.string(),
        role: z.enum(['lead', 'accompaniment', 'bass', 'drums', 'vocal', 'pad', 'other']),
        instrument: z.string().optional(),
        notes: z.array(melodyNoteSchema).min(1),
      }),
    )
    .optional(),
  lyrics: z.string().optional(),
  durationSeconds: z.number().optional(),
})

const responseSchema = z.object({
  variants: z.array(aiVariantSchema).min(1),
})

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))
const TARGET_SONG_BARS = Number(process.env.TARGET_SONG_BARS || 32)

const noteOrder = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const noteToMidi = (note) => {
  const m = /^([A-G]{1}(#|b)?)(-?\d)$/.exec(note)
  if (!m) return 60
  const [, pitch, accidental, octave] = m
  const octaveNum = Number(octave)
  let idx = noteOrder.indexOf(pitch)
  if (idx === -1 && accidental === 'b') {
    const natural = pitch[0]
    const naturalIdx = noteOrder.indexOf(natural)
    idx = (naturalIdx + 11) % 12
  }
  return 12 * (octaveNum + 1) + idx
}
const midiToNote = (midi) => {
  const clamped = Math.min(Math.max(midi, 24), 96)
  const pitch = clamped % 12
  const octave = Math.floor(clamped / 12) - 1
  return `${noteOrder[pitch]}${octave}`
}
const shiftMelody = (melody, semitones) =>
  melody.map((n) => ({ ...n, note: midiToNote(noteToMidi(n.note) + semitones) }))

const buildTrack = (id, role, instrument, notes) => ({ id, role, instrument, notes })

const buildRhythmPattern = (bars, bpm) => {
  const pattern = []
  for (let bar = 0; bar < bars; bar += 1) {
    const offset = bar * 4
    pattern.push({ beat: 1 + offset, note: 'C2', length: '1/4' }) // kick
    pattern.push({ beat: 3 + offset, note: 'C2', length: '1/4' }) // kick
    pattern.push({ beat: 2 + offset, note: 'D2', length: '1/4' }) // snare
    pattern.push({ beat: 4 + offset, note: 'D2', length: '1/4' }) // snare
    pattern.push({ beat: 1 + offset, note: 'F#3', length: '1/8' }) // hat
    pattern.push({ beat: 1.5 + offset, note: 'F#3', length: '1/8' })
    pattern.push({ beat: 2 + offset, note: 'F#3', length: '1/8' })
    pattern.push({ beat: 2.5 + offset, note: 'F#3', length: '1/8' })
    pattern.push({ beat: 3 + offset, note: 'F#3', length: '1/8' })
    pattern.push({ beat: 3.5 + offset, note: 'F#3', length: '1/8' })
    pattern.push({ beat: 4 + offset, note: 'F#3', length: '1/8' })
    pattern.push({ beat: 4.5 + offset, note: 'F#3', length: '1/8' })
  }
  return pattern
}

const buildBassline = (bars, keyRoot) => {
  const pattern = []
  const notes = ['C2', 'G2', 'A2', 'F2']
  for (let bar = 0; bar < bars; bar += 1) {
    const note = notes[bar % notes.length]
    const offset = bar * 4
    pattern.push({ beat: 1 + offset, note, length: '1/2' })
    pattern.push({ beat: 3 + offset, note, length: '1/2' })
  }
  return pattern
}

const cloneTrack = (track, semitones, idSuffix) => ({
  ...track,
  id: `${track.id}-${idSuffix}`,
  notes: shiftMelody(track.notes, semitones),
})

const buildSections = (bars) => {
  const sectionDefs = [
    { name: 'Intro', bars: Math.max(4, Math.floor(bars * 0.05)) },
    { name: 'Verse', bars: Math.max(8, Math.floor(bars * 0.25)) },
    { name: 'Chorus', bars: Math.max(8, Math.floor(bars * 0.25)) },
    { name: 'Bridge', bars: Math.max(4, Math.floor(bars * 0.1)) },
    { name: 'Chorus', bars: Math.max(8, Math.floor(bars * 0.25)) },
    { name: 'Outro', bars: Math.max(4, Math.floor(bars * 0.1)) },
  ]
  const total = sectionDefs.reduce((sum, s) => sum + s.bars, 0)
  const scale = bars / total
  return sectionDefs.map((s, idx) => {
    const scaled = Math.max(4, Math.round(s.bars * scale))
    return { ...s, bars: scaled, pattern: idx % 2 === 0 ? 'call' : 'response' }
  })
}

const buildLocalVariants = (req, now) => {
  const bars = 96 // ~3.2分 at 120 BPM
  const baseMelody = []
  for (let bar = 0; bar < bars; bar += 1) {
    const offset = bar * 4
    baseMelody.push(
      { beat: 1 + offset, note: 'C4', length: '1/4' },
      { beat: 1.5 + offset, note: 'E4', length: '1/4' },
      { beat: 2 + offset, note: 'G4', length: '1/2' },
      { beat: 3.5 + offset, note: 'A4', length: '1/4' },
      { beat: 4 + offset, note: 'G4', length: '1/4' },
    )
  }
  const chords = []
  const chordPool = ['Cmaj7', 'Am7', 'Dm7', 'G7', 'Fmaj7', 'Em7', 'Dm7', 'G7']
  for (let bar = 0; bar < bars; bar += 1) {
    chords.push({ bar: bar + 1, chord: chordPool[bar % chordPool.length] })
  }

  const lead = buildTrack('lead', 'lead', 'piano', baseMelody)
  const accomp = buildTrack('accomp', 'accompaniment', 'piano', shiftMelody(baseMelody, -12))
  const bass = buildTrack('bass', 'bass', 'bass', buildBassline(bars, req.key))
  const drums = buildTrack('drums', 'drums', 'drums', buildRhythmPattern(bars, req.bpm))

  const sections = buildSections(bars)

  return [0, 2, -2].map((shift, idx) => {
    const tracks =
      shift === 0
        ? [lead, accomp, bass, drums]
        : [cloneTrack(lead, shift, `v${idx}`), cloneTrack(accomp, shift, `v${idx}`), bass, drums]
    return {
      id: `${randomUUID()}-${idx}`,
      title: `${req.section}案 ${idx + 1}`,
      prompt: req.prompt,
      bpm: req.bpm,
      durationSeconds: (bars * 4 * 60) / req.bpm,
      key: { root: req.key, mode: req.key.toLowerCase().includes('m') ? 'minor' : 'major' },
      tags: req.moodTags,
      sections,
      melody: tracks[0].notes,
      chords,
      tracks,
      lyrics: '♪ la la la ♪',
      createdAt: now,
      updatedAt: now,
    }
  })
}

const buildPrompt = (sectionReq) => {
  const tagLine =
    sectionReq.moodTags && sectionReq.moodTags.length
      ? `Tags: ${sectionReq.moodTags.join(', ')}`
      : 'Tags: (none)'
  return `
You are a songwriting assistant. Create short song sections as JSON.
- Provide EXACTLY 3 variants.
- Each variant includes sections totaling around ${sectionReq.targetBars} bars for this call.
- Each variant includes tracks: lead, accompaniment, bass, drums. Optional: vocal placeholder/lyrics.
- Key: ${sectionReq.key}, BPM: ${sectionReq.bpm}, Section: ${sectionReq.section}
- ${tagLine}
- Output JSON ONLY. No prose.
- Schema:
{
  "variants": [
    {
      "title": "string",
      "sections": [{ "name": "string", "bars": number, "pattern": "string" }],
      "melody": [{ "beat": number, "note": "C4", "length": "1/4" }],
      "chords": [{ "bar": number, "chord": "Cmaj7" }],
      "tags": ["string"],
      "tracks": [
        { "id": "lead", "role": "lead", "instrument": "piano", "notes": [{ "beat": 1, "note": "C4", "length": "1/4" }] },
        { "id": "accomp", "role": "accompaniment", "instrument": "piano", "notes": [...] },
        { "id": "bass", "role": "bass", "instrument": "bass", "notes": [...] },
        { "id": "drums", "role": "drums", "instrument": "drums", "notes": [...] }
      ],
      "lyrics": "optional lyrics text",
      "durationSeconds": 60
    }
  ]
}
- Melody rules: beat starts at 1, lengths allowed: ${lengthValues.join(', ')}.
- Keep it concise: no more than 2 notes per beat per track.
- Use scale tones for ${sectionReq.key}. Keep total length around ${sectionReq.targetBars} bars.
- Chords: 1 per bar is enough; align bar count with melody length.
- Drums: simple repeating pattern is acceptable (kick on 1/3, snare on 2/4, hats on 1/8).
- Bass: root or fifth per bar is fine.
- Return valid JSON only.`
}

const getNoteLengthBeats = (len) => lengthToBeats[len] ?? 1

const calcSegmentLength = (variant) => {
  const melodyBeats =
    variant.melody?.reduce(
      (max, n) => Math.max(max, n.beat + getNoteLengthBeats(n.length)),
      0,
    ) || 0
  const trackBeats =
    variant.tracks?.reduce(
      (max, t) =>
        Math.max(
          max,
          (t.notes || []).reduce(
            (m, n) => Math.max(m, n.beat + getNoteLengthBeats(n.length)),
            0,
          ),
        ),
      0,
    ) || 0
  const chordBars = variant.chords?.reduce((max, c) => Math.max(max, c.bar), 0) || 0
  const sectionBars = variant.sections?.reduce((sum, s) => sum + s.bars, 0) || 0
  const beats = Math.max(melodyBeats, trackBeats, chordBars * 4, sectionBars * 4)
  const bars = Math.max(chordBars, sectionBars, Math.ceil(beats / 4))
  return { beats: beats || 16, bars: bars || 4 }
}

const mergeTracks = (segmentsWithOffset) => {
  if (!segmentsWithOffset.length) return []
  const merged = new Map()
  segmentsWithOffset.forEach(({ tracks, offset }) => {
    tracks?.forEach((t) => {
      const key = `${t.role}-${t.id || 'default'}`
      const shifted = t.notes.map((n) => ({ ...n, beat: n.beat + offset }))
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, { ...t, notes: shifted })
      } else {
        merged.set(key, { ...existing, notes: [...existing.notes, ...shifted] })
      }
    })
  })
  return Array.from(merged.values())
}

const trimNotesToBars = (notes, bars) => notes.filter((n) => n.beat <= bars * 4 + 0.0001)
const trimChordsToBars = (chords, bars) => chords.filter((c) => c.bar <= bars)
const trimTracksToBars = (tracks, bars) =>
  tracks.map((t) => ({ ...t, notes: trimNotesToBars(t.notes || [], bars) }))

const extendVariant = (variant, targetBars, req, now) => {
  // limit repetition: repeat at most 3 times and cap bars
  const seedLength = calcSegmentLength(variant)
  const maxRepeats = 3
  const repeats = Math.min(
    maxRepeats,
    Math.max(1, Math.ceil(targetBars / Math.max(1, seedLength.bars))),
  )
  let beatOffset = 0
  let barOffset = 0
  const melody = []
  const chords = []
  const trackSegments = []
  const sections = []
  for (let i = 0; i < repeats; i += 1) {
    melody.push(...(variant.melody || []).map((n) => ({ ...n, beat: n.beat + beatOffset })))
    chords.push(...(variant.chords || []).map((c) => ({ ...c, bar: c.bar + barOffset })))
    trackSegments.push({ tracks: variant.tracks || [], offset: beatOffset })
    sections.push(...(variant.sections || []))
    beatOffset += seedLength.beats
    barOffset += seedLength.bars
  }
  const limitedBars = Math.min(barOffset, targetBars)
  const tracks = mergeTracks(trackSegments)
  const trimmedTracks = trimTracksToBars(tracks, limitedBars)
  const trimmedMelody = trimNotesToBars(melody, limitedBars)
  const trimmedChords = trimChordsToBars(chords, limitedBars)
  return {
    ...variant,
    id: `${randomUUID()}`,
    prompt: req.prompt,
    bpm: req.bpm,
    durationSeconds: (limitedBars * 4 * 60) / req.bpm,
    key: { root: req.key, mode: req.key.toLowerCase().includes('m') ? 'minor' : 'major' },
    tags: req.moodTags,
    sections,
    melody: trimmedMelody,
    chords: trimmedChords,
    tracks: trimmedTracks,
    lyrics: variant.lyrics || '♪ la la la ♪',
    createdAt: now,
    updatedAt: now,
  }
}

const concatVariants = (segments, now, req) => {
  // segments: array of ComposeResponse from GPT (or empty)
  if (!segments.length) return buildLocalVariants(req, now)

  const mergedVariants = []
  for (let i = 0; i < segments[0].variants.length; i += 1) {
    const variantSegments = segments.map((seg) => seg.variants[i])
    const sections = variantSegments.flatMap((v) => v.sections)
    const melody = []
    const chords = []
    const trackSegments = []
    let beatOffset = 0
    let barOffset = 0

    variantSegments.forEach((v) => {
      const segLength = calcSegmentLength(v)
      const segMelody = v.melody?.map((n) => ({ ...n, beat: n.beat + beatOffset })) || []
      const segChords = v.chords?.map((n) => ({ ...n, bar: n.bar + barOffset })) || []
      melody.push(...segMelody)
      chords.push(...segChords)
      trackSegments.push({ tracks: v.tracks || [], offset: beatOffset })
      beatOffset += segLength.beats
      barOffset += segLength.bars
    })

    const totalBars = barOffset || Math.ceil((beatOffset || 16) / 4)
    const tracks = mergeTracks(trackSegments)
    mergedVariants.push({
      id: `${randomUUID()}-${i}`,
      title: variantSegments.map((v) => v.title).join(' / '),
      prompt: req.prompt,
      bpm: req.bpm,
      durationSeconds: (totalBars * 4 * 60) / req.bpm,
      key: { root: req.key, mode: req.key.toLowerCase().includes('m') ? 'minor' : 'major' },
      tags: req.moodTags,
      sections,
      melody: melody.length ? melody : tracks[0]?.notes || [],
      chords,
      tracks,
      lyrics: variantSegments.map((v) => v.lyrics || '').filter(Boolean).join('\n'),
      createdAt: now,
      updatedAt: now,
    })
  }
  return mergedVariants
}

app.post('/compose', async (req, res) => {
  const reqId = randomUUID()
  const started = Date.now()
  const parsed = composeRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    console.warn(`compose_invalid reqId=${reqId}`)
    return res.status(400).json({ error: 'invalid_request', detail: parsed.error.format() })
  }
  const now = new Date().toISOString()
  console.log(
    `compose_start reqId=${reqId} key=${parsed.data.key} bpm=${parsed.data.bpm} section="${parsed.data.section}"`,
  )

  // seed with GPT (short motifs) and locally extend to full length; fallback to local if GPT fails
  if (process.env.OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      const seedBars = Number(process.env.OPENAI_SEED_BARS || 8)
      const prompt = buildPrompt({ ...parsed.data, targetBars: seedBars })
      console.log(`compose_seed_request reqId=${reqId} bars=${seedBars}`)
      const completion = await openai.chat.completions.create({
        model: MODEL,
        temperature: 0.7,
        max_tokens: 3000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Return JSON only. Keep melodies simple and diatonic.' },
          { role: 'user', content: prompt },
        ],
      })
      const content = completion.choices[0]?.message?.content
      if (!content) throw new Error('Empty completion')
      const parsedJson = responseSchema.safeParse(JSON.parse(content))
      if (!parsedJson.success) throw new Error(`Validation failed: ${parsedJson.error.message}`)
      const expanded = parsedJson.data.variants.map((v) =>
        extendVariant(v, TARGET_SONG_BARS, parsed.data, now),
      )
      console.log(
        `compose_success reqId=${reqId} source=openai_seed seedBars=${seedBars} targetBars=${TARGET_SONG_BARS} ms=${Date.now() - started}`,
      )
      return res.json({
        variants: expanded,
        source: 'openai_seed',
        seedBars,
        targetBars: TARGET_SONG_BARS,
      })
    } catch (err) {
      console.error('compose_openai_error', { reqId, err })
    }
  }

  // fallback to local generation
  const variants = buildLocalVariants(parsed.data, now)
  console.log(
    `compose_success reqId=${reqId} source=local_fallback targetBars=${TARGET_SONG_BARS} ms=${Date.now() - started}`,
  )
  return res.json({ variants, fallback: true })
})

app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    model: MODEL,
    targetSongBars: TARGET_SONG_BARS,
    seedBars: Number(process.env.OPENAI_SEED_BARS || 8),
    hasApiKey: Boolean(process.env.OPENAI_API_KEY),
  }),
)

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`)
})
