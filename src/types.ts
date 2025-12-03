export type MelodyNote = {
  beat: number
  note: string
  length: string
}

export type Track = {
  id: string
  role: 'lead' | 'accompaniment' | 'bass' | 'drums' | 'vocal' | 'pad' | 'other'
  instrument?: string
  notes: MelodyNote[]
}

export type ChordEvent = {
  bar: number
  chord: string
}

export type SectionInfo = {
  name: string
  bars: number
  pattern: string
}

export type SongIdea = {
  id: string
  title: string
  prompt: string
  bpm: number
  key: { root: string; mode: string }
  tags: string[]
  sections: SectionInfo[]
  tracks?: Track[]
  lyrics?: string
  durationSeconds?: number
  melody: MelodyNote[]
  chords: ChordEvent[]
  createdAt: string
  updatedAt: string
}

export type ComposeRequest = {
  prompt: string
  key: string
  bpm: number
  section: string
  moodTags: string[]
}

export type ComposeResponse = {
  variants: SongIdea[]
  fallback?: boolean
  source?: string
  seedBars?: number
  targetBars?: number
}
