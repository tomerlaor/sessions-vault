export interface LyricsSection {
  name: string;
  chords: string; // e.g. "Am - F - C - G"
}

const CHORD_RE =
  /^\[([A-G][b#]?(?:sus[24]?(?:maj|min|m|M)?[0-9]*|(?:maj|min|dim|aug|dom|alt|add|m|M)?[0-9]*)(?:[b#][0-9]+)*(?:\/[A-G][b#]?)?)\]$/;

function isChordToken(token: string): boolean {
  return CHORD_RE.test(token);
}

function isSectionHeader(line: string): boolean {
  const t = line.trim();
  if (!/^\[.+\]$/.test(t)) return false;
  // Lines with multiple bracket groups are chord progressions, not section headers
  const groups = t.match(/\[[^\]]+\]/g) ?? [];
  if (groups.length > 1) return false;
  return !isChordToken(t);
}

function extractChordsFromLine(line: string): string[] {
  const matches = [...line.matchAll(/\[([^\]]+)\]/g)];
  return matches.map((m) => m[1]).filter((c) => isChordToken(`[${c}]`));
}

export function parseLyricsStructure(lyrics: string | null): LyricsSection[] {
  if (!lyrics?.trim()) return [];

  const lines = lyrics.split("\n");
  const sections: LyricsSection[] = [];
  let currentSection: string | null = null;
  const chordSet: string[] = [];
  const seen = new Set<string>();

  const flush = () => {
    if (currentSection !== null) {
      sections.push({
        name: currentSection,
        chords: chordSet.length > 0 ? chordSet.join(" - ") : "",
      });
    }
    chordSet.length = 0;
    seen.clear();
  };

  for (const line of lines) {
    if (isSectionHeader(line)) {
      flush();
      currentSection = line.trim().slice(1, -1);
    } else {
      if (currentSection === null) currentSection = "Intro";
      for (const chord of extractChordsFromLine(line)) {
        if (!seen.has(chord)) {
          seen.add(chord);
          chordSet.push(chord);
        }
      }
    }
  }

  flush();

  // Deduplicate by name — keep first occurrence, merge any extra chords into it
  const deduped: LyricsSection[] = [];
  const byName = new Map<string, LyricsSection>();
  for (const s of sections) {
    if (!s.chords && !s.name) continue;
    if (byName.has(s.name)) {
      const existing = byName.get(s.name)!;
      if (s.chords && !existing.chords.includes(s.chords)) {
        existing.chords = existing.chords
          ? `${existing.chords} - ${s.chords}`
          : s.chords;
      }
    } else {
      const entry = { ...s };
      byName.set(s.name, entry);
      deduped.push(entry);
    }
  }
  return deduped;
}
