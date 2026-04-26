import { useState, useEffect, useCallback, useMemo } from 'react'
import { getProjects } from '../db/queries/projects'
import type { Project } from '../types'

export interface Filter {
  view: 'all' | 'starred' | 'recent' | 'dirty' | 'archived'
  daw: string | null
  collection: string | null
  tags: string[]
  search: string
}

export interface Sort {
  key: keyof Project | 'lastSync'
  dir: 'asc' | 'desc'
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const rows = await getProjects()
    setProjects(rows)
    setLoading(false)
  }, [])

  useEffect(() => { reload() }, [reload])

  return { projects, setProjects, reload, loading }
}

export function useFilteredProjects(
  projects: Project[],
  filter: Filter,
  sort: Sort
): Project[] {
  return useMemo(() => {
    let list = projects.slice()
    if (filter.view === 'archived') {
      list = list.filter(p => p.status === 'archived')
    } else {
      list = list.filter(p => p.status !== 'archived')
      if (filter.view === 'starred') list = list.filter(p => (p as any).starred)
      if (filter.view === 'dirty')   list = list.filter(p => p.status === 'draft')
      if (filter.view === 'recent')  list = list.slice(0, 6)
    }
    if (filter.daw)   list = list.filter(p => p.daw === filter.daw)
    if (filter.tags.length) list = list.filter(p => filter.tags.every(t => (p.tags||[]).includes(t)))
    if (filter.search) {
      const q = filter.search.toLowerCase()
      list = list.filter(p =>
        p.title.toLowerCase().includes(q) ||
        (p.notes||'').toLowerCase().includes(q) ||
        (p.tags||[]).some(t => t.includes(q))
      )
    }
    list.sort((a, b) => {
      const av = (a as any)[sort.key] ?? ''
      const bv = (b as any)[sort.key] ?? ''
      if (av < bv) return sort.dir === 'asc' ? -1 : 1
      if (av > bv) return sort.dir === 'asc' ?  1 : -1
      return 0
    })
    return list
  }, [projects, filter, sort])
}
