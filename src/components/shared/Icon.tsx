import React from 'react'

type IconName =
  | 'search' | 'folder' | 'star' | 'sync' | 'music' | 'tag' | 'tune'
  | 'plus' | 'play' | 'pause' | 'open' | 'x' | 'dots' | 'chevron'
  | 'check' | 'paperclip' | 'waveform' | 'image' | 'doc' | 'grid'
  | 'list' | 'history' | 'upload' | 'section' | 'bold' | 'italic' | 'link'
  | 'drive' | 'mic' | 'settings' | 'archive'

interface IconProps {
  name: IconName
  size?: number
  style?: React.CSSProperties
  stroke?: number
}

const paths: Record<IconName, React.ReactNode> = {
  search:    <><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></>,
  folder:    <path d="M2 4.5C2 3.67 2.67 3 3.5 3h3.2c.4 0 .78.16 1.06.44L8.7 4.25a1.5 1.5 0 001.06.44H12.5c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5h-9A1.5 1.5 0 012 12.19V4.5z"/>,
  star:      <path d="M8 1.5l1.95 3.95L14 6.04l-3 2.92.7 4.1L8 11.12l-3.7 1.94.7-4.1L2 6.04l4.05-.59L8 1.5z"/>,
  sync:      <><path d="M13 4.5A5 5 0 004 5.5m-1 6A5 5 0 0012 11"/><path d="M13 2v3h-3M3 14v-3h3" strokeLinejoin="round"/></>,
  music:     <><circle cx="4" cy="12" r="1.8"/><circle cx="12" cy="10.5" r="1.8"/><path d="M5.8 12V3l8-1.5v9"/></>,
  tag:       <><path d="M2 2h5.5L14 8.5 8.5 14 2 7.5V2z"/><circle cx="5" cy="5" r="1" fill="currentColor"/></>,
  tune:      <><path d="M2 4h8M13 4h1M2 12h1M6 12h8"/><circle cx="11.5" cy="4" r="1.5"/><circle cx="4.5" cy="12" r="1.5"/></>,
  plus:      <path d="M8 3v10M3 8h10"/>,
  play:      <path d="M5 3l8 5-8 5V3z" fill="currentColor"/>,
  pause:     <path d="M5 3h2v10H5zM9 3h2v10H9z" fill="currentColor"/>,
  open:      <><path d="M9 2h5v5"/><path d="M14 2L7.5 8.5"/><path d="M12 9v4a1 1 0 01-1 1H3a1 1 0 01-1-1V5a1 1 0 011-1h4"/></>,
  x:         <path d="M3 3l10 10M13 3L3 13"/>,
  dots:      <><circle cx="3" cy="8" r="1.2" fill="currentColor"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="13" cy="8" r="1.2" fill="currentColor"/></>,
  chevron:   <path d="M6 3l4 5-4 5"/>,
  check:     <path d="M3 8l3.5 3L13 4"/>,
  paperclip: <path d="M12.5 7l-5 5a3 3 0 01-4.24-4.24l6-6a2 2 0 012.83 2.83L6.5 10.5a1 1 0 01-1.41-1.41L9.5 4.5"/>,
  waveform:  <path d="M1 8h2M4 5v6M7 3v10M10 5v6M13 8h2"/>,
  image:     <><rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.5" cy="6.5" r="1"/><path d="M2 11l3.5-3 3 2.5L12 7l2 2"/></>,
  doc:       <><path d="M3 2h6l3 3v9H3V2z"/><path d="M6 8h4M6 10.5h4M6 5.5h2"/></>,
  grid:      <><rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/></>,
  list:      <path d="M2 4h12M2 8h12M2 12h12"/>,
  history:   <><circle cx="8" cy="8" r="6"/><path d="M8 5v3.5L10.5 10"/></>,
  upload:    <><path d="M8 3v8M5 6l3-3 3 3"/><path d="M3 13h10"/></>,
  section:   <path d="M2 4h12M2 8h8M2 12h12"/>,
  bold:      <path d="M4 2h4.5a2.5 2.5 0 010 5H4V2zm0 5h5a2.5 2.5 0 010 5H4V7z"/>,
  italic:    <path d="M6 2h6M4 14h6M9 2l-2 12"/>,
  link:      <><path d="M10 6h1a3 3 0 010 6h-1M6 10H5a3 3 0 010-6h1"/><path d="M7 8h2"/></>,
  drive:     <><ellipse cx="8" cy="6" rx="6" ry="3"/><path d="M2 6v4a6 3 0 0012 0V6"/><path d="M2 10a6 3 0 0012 0"/></>,
  mic:       <><rect x="6" y="2" width="4" height="7" rx="2"/><path d="M3.5 8a4.5 4.5 0 009 0M8 12.5V14M5 14h6"/></>,
  settings:  <><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4"/></>,
  archive:   <><rect x="2" y="6" width="12" height="8" rx="1"/><path d="M2 6l1.5-3h9L14 6"/><path d="M6 10h4"/></>,
}

export default function Icon({ name, size = 14, style, stroke = 1.8 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth={stroke} strokeLinecap="round"
      style={{ display: 'inline-block', flexShrink: 0, ...style }}>
      {paths[name]}
    </svg>
  )
}
