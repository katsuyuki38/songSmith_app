import { Midi } from '@tonejs/midi'
import type { MelodyNote } from '../types'

const NOTE_ORDER = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export const fallbackId = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10)

export const noteToMidi = (note: string): number => {
  const match = note.match(/^([A-G]{1}(#|b)?)(-?\d)$/)
  if (!match) return 60
  const [, pitch, accidental, octave] = match
  const octaveNum = Number(octave)
  const baseIndex = NOTE_ORDER.indexOf(pitch)
  let idx = baseIndex
  if (idx === -1 && accidental === 'b') {
    const natural = pitch[0]
    const naturalIdx = NOTE_ORDER.indexOf(natural)
    idx = (naturalIdx + 11) % 12
  }
  return 12 * (octaveNum + 1) + idx
}

export const midiToNoteName = (midi: number): string => {
  const pitch = midi % 12
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_ORDER[pitch]}${octave}`
}

export const shiftNote = (note: string, delta: number) => {
  const midi = noteToMidi(note)
  const shifted = midi + delta
  const clamped = Math.min(Math.max(shifted, 24), 96)
  return midiToNoteName(clamped)
}

export const lengthToBeats = (length: string): number => {
  if (!length || !length.includes('/')) return 1
  const [num, den] = length.split('/').map(Number)
  if (!den || Number.isNaN(num)) return 1
  return num / den
}

export const getEndBeat = (melody: MelodyNote[]) => {
  if (melody.length === 0) return 0
  return Math.max(...melody.map((n) => n.beat + lengthToBeats(n.length)))
}

export const beatsToSeconds = (beats: number, bpm: number) => {
  if (bpm === 0) return 0
  return beats * (60 / bpm)
}

type MidiTrack = Midi['tracks'][number]

export const buildMidiFile = (
  melody: MelodyNote[],
  bpm: number,
  tracks?: { id: string; role: string; notes: MelodyNote[] }[],
) => {
  const midi = new Midi()
  midi.header.setTempo(bpm)
  const secPerBeat = 60 / bpm

  const addNotesToTrack = (track: MidiTrack, notes: MelodyNote[]) => {
    notes.forEach((note) => {
      const start = (note.beat - 1) * secPerBeat
      const duration = lengthToBeats(note.length) * secPerBeat
      track.addNote({
        midi: noteToMidi(note.note),
        time: start,
        duration,
        name: note.note,
        velocity: 0.9,
      })
    })
  }

  if (tracks && tracks.length > 0) {
    tracks.forEach((t) => {
      const track = midi.addTrack()
      track.name = t.role
      addNotesToTrack(track, t.notes)
    })
  } else {
    const track = midi.addTrack()
    addNotesToTrack(track, melody)
  }

  return midi.toArray()
}
