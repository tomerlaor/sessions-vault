import ProjectRow from './ProjectRow'
import { deterministicWave } from '../shared/WaveArt'
import type { Project } from '../../types'
import type { Sort } from '../../hooks/useProjects'

const GRAD = (a: string, b: string) => `linear-gradient(135deg, ${a} 0%, ${b} 100%)`
const PROJECT_ART: Record<string, string> = {}
const COLORS = [
  ['#6b21a8','#ec4899'], ['#f59e0b','#b45309'], ['#0ea5e9','#1e3a8a'],
  ['#475569','#0f172a'], ['#22c55e','#14532d'], ['#be123c','#7c2d12'],
]
function artForProject(id: string): string {
  if (!PROJECT_ART[id]) {
    const i = id.charCodeAt(0) % COLORS.length
    PROJECT_ART[id] = GRAD(COLORS[i][0], COLORS[i][1])
  }
  return PROJECT_ART[id]
}

const COLS = [
  { key: 'title',      label: 'Project'   },
  { key: 'daw',        label: 'DAW'       },
  { key: 'status',     label: 'Sync'      },
  { key: 'bpm',        label: 'BPM / Key' },
  { key: 'tags',       label: 'Tags'      },
  { key: 'modifiedAt', label: 'Modified'  },
  { key: 'sizeBytes',  label: 'Size'      },
  { key: '__',         label: ''          },
]

interface ProjectListProps {
  projects: Project[]
  selectedId: string | null
  sort: Sort
  setSort: (s: Sort) => void
  onSelect: (id: string) => void
  onReveal: (p: Project) => void
  onOpen: (p: Project) => void
  label: string
}

export default function ProjectList({ projects, selectedId, sort, setSort, onSelect, onReveal, onOpen, label }: ProjectListProps) {
  const sortIcon = (key: string) => sort.key === key ? (sort.dir === 'asc' ? '↑' : '↓') : ''
  const handleSort = (key: string) => {
    if (key === '__') return
    setSort({ key: key as Sort['key'], dir: sort.key === key && sort.dir === 'asc' ? 'desc' : 'asc' })
  }

  return (
    <div className="list-pane">
      <div className="list-header">
        <h1>{label}</h1>
        <span className="count">{projects.length}</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {COLS.map(c => (
                <th key={c.key} onClick={() => handleSort(c.key)}>
                  {c.label}<span className="sort-ind">{sortIcon(c.key)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {projects.map(p => (
              <ProjectRow key={p.id}
                project={p}
                wave={deterministicWave(p.id.charCodeAt(0))}
                art={artForProject(p.id)}
                selected={p.id === selectedId}
                onClick={() => onSelect(p.id)}
                onReveal={() => onReveal(p)}
                onOpen={() => onOpen(p)} />
            ))}
            {projects.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)' }}>
                No projects found.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
