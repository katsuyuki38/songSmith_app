import { fallbackId, getEndBeat, shiftNote } from '../lib/music'
import type { ComposeRequest, ComposeResponse, MelodyNote, SongIdea } from '../types'

const baseMelody: MelodyNote[] = [
  { beat: 1, note: 'C4', length: '1/4' },
  { beat: 2, note: 'E4', length: '1/4' },
  { beat: 3, note: 'G4', length: '1/4' },
  { beat: 4, note: 'A4', length: '1/4' },
  { beat: 5, note: 'G4', length: '1/4' },
  { beat: 6, note: 'E4', length: '1/4' },
  { beat: 7, note: 'D4', length: '1/4' },
  { beat: 8, note: 'C4', length: '1/2' },
]

const chordPool = [
  ['Cmaj7', 'Am7', 'Dm7', 'G7'],
  ['Fmaj7', 'G', 'Em7', 'Am7'],
  ['Dm7', 'G7', 'Cmaj7', 'Am7'],
]

const MELODY_LOOPS = 4 // repeat motif to make longer ideas

export const mockCompose = async (req: ComposeRequest): Promise<ComposeResponse> => {
  await new Promise((resolve) => setTimeout(resolve, 600))
  const now = new Date().toISOString()

  const variants: SongIdea[] = chordPool.map((chords, idx) => {
    const melody: MelodyNote[] = []
    const motifBeats = getEndBeat(baseMelody)
    for (let loop = 0; loop < MELODY_LOOPS; loop += 1) {
      const offset = loop * motifBeats
      baseMelody.forEach((note, nIdx) => {
        const shifted = idx === 0 ? note.note : shiftNote(note.note, idx === 1 ? 2 : -2)
        const length = (nIdx + loop) % 3 === 0 ? '1/2' : note.length
        melody.push({ ...note, note: shifted, length, beat: note.beat + offset })
      })
    }

    const targetBars = Math.ceil(getEndBeat(melody) / 4)
    const chordLoops = Math.max(1, Math.ceil(targetBars / chords.length))
    const chordProgression = Array.from({ length: chordLoops }, (_, loop) =>
      chords.map((chord, bar) => ({
        bar: bar + 1 + loop * chords.length,
        chord,
      })),
    ).flat()

    const bars = chordProgression.length

    return {
      id: `${fallbackId()}-${idx}`,
      title: `${req.section}案 ${idx + 1}`,
      prompt: req.prompt,
      bpm: req.bpm,
      key: { root: req.key, mode: req.key.toLowerCase().includes('m') ? 'minor' : 'major' },
      tags: req.moodTags,
      sections: [{ name: req.section, bars, pattern: idx === 0 ? 'call-response' : 'rise' }],
      melody,
      chords: chordProgression,
      createdAt: now,
      updatedAt: now,
    }
  })

  return { variants }
}
