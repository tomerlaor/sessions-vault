interface Annotation {
  value: string;
  title: string;
}

const GROUPS: { label: string; items: Annotation[] }[] = [
  {
    label: "Artic",
    items: [
      { value: "h", title: "Hammer on" },
      { value: "p", title: "Pull off" },
      { value: "b", title: "Bend" },
      { value: "r", title: "Release bend" },
      { value: "~", title: "Vibrato" },
      { value: "~~", title: "Wide vibrato" },
    ],
  },
  {
    label: "Slide",
    items: [
      { value: "/", title: "Slide up" },
      { value: "\\", title: "Slide down" },
      { value: "sl", title: "Legato slide" },
    ],
  },
  {
    label: "Special",
    items: [
      { value: "x", title: "Dead note" },
      { value: "(n)", title: "Ghost note" },
      { value: "T", title: "Tapping" },
      { value: "P.H.", title: "Pinched harmonic" },
      { value: "◇", title: "Natural harmonic" },
    ],
  },
  {
    label: "Effects",
    items: [
      { value: "P.M.", title: "Palm mute" },
      { value: "let ring", title: "Let ring" },
      { value: "tr", title: "Trill" },
      { value: "P.S.", title: "Pick scrape" },
    ],
  },
  {
    label: "Strokes",
    items: [
      { value: "⊓", title: "Down stroke" },
      { value: "V", title: "Up stroke" },
    ],
  },
];

interface Props {
  active: string | null;
  onChange: (value: string | null) => void;
}

export default function AnnotationToolbar({ active, onChange }: Props) {
  return (
    <div className="tab-annotation-bar">
      {GROUPS.map((group, gi) => (
        <div key={group.label} className="tab-annotation-group">
          {gi > 0 && <div className="tab-annotation-sep" />}
          <span className="tab-annotation-label">{group.label}</span>
          {group.items.map((item) => (
            <button
              key={item.value}
              title={item.title}
              className={`tab-annotation-btn${active === item.value ? " active" : ""}`}
              onClick={() => onChange(active === item.value ? null : item.value)}
            >
              {item.value}
            </button>
          ))}
        </div>
      ))}
      {active && (
        <div className="tab-annotation-status">
          <span>● {active} active</span>
          <button onClick={() => onChange(null)}>✕</button>
        </div>
      )}
    </div>
  );
}
