interface WaveArtProps {
  wave: number[]
  bg: string
  size?: number
}

export default function WaveArt({ wave, bg, size = 32 }: WaveArtProps) {
  const pad = size > 40 ? 6 : 3
  return (
    <div style={{ width: size, height: size, borderRadius: 4, flexShrink: 0,
      background: bg, display: 'flex', alignItems: 'flex-end',
      gap: 1, padding: pad, overflow: 'hidden' }}>
      {wave.map((v, i) => (
        <div key={i} style={{ flex: 1, background: 'rgba(255,255,255,0.55)',
          height: `${v * 100}%`, borderRadius: 0.5, minHeight: 2 }} />
      ))}
    </div>
  )
}

export function deterministicWave(seed: number, n = 28): number[] {
  const out: number[] = []
  let s = seed
  for (let i = 0; i < n; i++) {
    s = (s * 9301 + 49297) % 233280
    out.push(0.2 + (s / 233280) * 0.8)
  }
  return out
}
