export interface LyricsSection {
  name: string
  chords: string  // e.g. "Am - F - C - G"
}

const CHORD_RE = /^\[([A-G][b#]?(m|maj|min|dim|aug|sus|add|M)?[0-9]*)\]$/

function isChordToken(token: string): boolean {
  return CHORD_RE.test(token)
}

function isSectionHeader(line: string): boolean {
  const t = line.trim()
  if (!/^\[.+\]$/.test(t)) return false
  const inner = t.slice(1, -1)
  return !isChordToken(t) && !/^[A-G][b#]?(m|maj|min|dim|aug|sus|add|M)?[0-9]*$/.test(inner)
}

function extractChordsFromLine(line: string): string[] {
  const matches = [...line.matchAll(/\[([^\]]+)\]/g)]
  return matches
    .map(m => m[1])
    .filter(c => isChordToken(`[${c}]`))
}

export function parseLyricsStructure(lyrics: string | null): LyricsSection[] {
  if (!lyrics?.trim()) return []

  const lines = lyrics.split('\n')
  const sections: LyricsSection[] = []
  let currentSection: string | null = null
  const chordSet: string[] = []
  const seen = new Set<string>()

  const flush = () => {
    if (currentSection !== null) {
      sections.push({
        name: currentSection,
        chords: chordSet.length > 0 ? chordSet.join(' - ') : '',
      })
    }
    chordSet.length = 0
    seen.clear()
  }

  for (const line of lines) {
    if (isSectionHeader(line)) {
      flush()
      currentSection = line.trim().slice(1, -1)
    } else {
      if (currentSection === null) currentSection = 'Intro'
      for (const chord of extractChordsFromLine(line)) {
        if (!seen.has(chord)) {
          seen.add(chord)
          chordSet.push(chord)
        }
      }
    }
  }

  flush()

  return sections.filter(s => s.chords || s.name)
}
