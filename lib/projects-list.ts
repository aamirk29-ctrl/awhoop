// Active Claude Code project tracker — deliberately not a git integration
// (no last-commit, no open TODOs). Notes are the point; array order is
// display order, reordered the same way GoalsPanel reorders goals.

import { storeGet, storeSet } from './storage';

export type ProjectStatus = 'active' | 'paused' | 'shipped';

export type ProjectEntry = {
  id: string;
  name: string;
  status: ProjectStatus;
  notes: string;
  updatedAt: number;
  archived: boolean;
};

const KEY = 'projects_list_v1';

export function loadProjects(): ProjectEntry[] {
  return storeGet<ProjectEntry[]>(KEY) || [];
}

function save(list: ProjectEntry[]) {
  storeSet(KEY, list);
}

export function addProject(name: string, status: ProjectStatus = 'active') {
  const list = loadProjects();
  list.push({
    id: `p${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    name,
    status,
    notes: '',
    updatedAt: Date.now(),
    archived: false,
  });
  save(list);
}

export function updateProject(
  id: string,
  patch: Partial<Pick<ProjectEntry, 'name' | 'status' | 'notes'>>,
) {
  const list = loadProjects();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], ...patch, updatedAt: Date.now() };
  save(list);
}

export function toggleArchive(id: string) {
  const list = loadProjects();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], archived: !list[idx].archived, updatedAt: Date.now() };
  save(list);
}

export function deleteProject(id: string) {
  save(loadProjects().filter((p) => p.id !== id));
}

/** Moves `id` to just before `beforeId` in the stored (unfiltered) list —
 *  same splice-based reorder GoalsPanel uses, but id-keyed rather than
 *  index-keyed, because the visible list can be filtered (archived hidden)
 *  while this always operates on the full stored array. Array order is
 *  display order; there's no separate order field. */
export function reorderProjects(id: string, beforeId: string) {
  if (id === beforeId) return;
  const list = loadProjects();
  const from = list.findIndex((p) => p.id === id);
  if (from === -1) return;
  const [moved] = list.splice(from, 1);
  const to = list.findIndex((p) => p.id === beforeId);
  list.splice(to === -1 ? list.length : to, 0, moved);
  save(list);
}
