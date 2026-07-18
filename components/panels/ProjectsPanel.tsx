'use client';

// Projects panel — three tabs (CFA / Projects / Network), only CFA wired up
// this phase; the other two scaffold the tab bar per the rollout plan. CFA
// topic tree ported from the old standalone personal_planner.html artifact;
// the old file's Calendar "integration" and progress persistence never
// actually worked (see BUILD notes), so both are built fresh here, backed by
// this app's existing localStorage + cloud-sync layer.

import * as React from 'react';
import {
  Archive,
  ArchiveRestore,
  CalendarPlus,
  ChevronDown,
  ChevronRight,
  GripVertical,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  UserPlus,
} from 'lucide-react';
import type { BentoAccent } from '@/components/ui/aurora-bento-grid';
import { cn } from '@/lib/utils';
import { storeGet, storeSet, useStorageTick } from '@/lib/storage';
import { formatDateKey } from '@/lib/dates';
import { MiniRing } from '@/components/dashboard/mini-viz';
import {
  CFA_READINGS,
  CFA_TOPICS,
  EXAM_DATE,
  STUDY_SLOTS,
  type CfaTopic,
  type StudySlot,
  type StudySlotConfig,
  daysUntilExam,
  doneCount,
  getTopicNote,
  loadCfaProgress,
  loadStudySlots,
  markTopicReviewed,
  mostStaleTopics,
  pctComplete,
  readingsForTopic,
  saveTopicNote,
  saveStudySlots,
  sessionsRemaining,
  toggleReadingDone,
  isDone,
} from '@/lib/cfa';
import {
  addProject,
  deleteProject,
  loadProjects,
  reorderProjects,
  toggleArchive,
  updateProject,
  type ProjectEntry,
  type ProjectStatus,
} from '@/lib/projects-list';
import {
  addContact,
  deleteContact,
  loadContacts,
  loadStaleWeeks,
  saveStaleWeeks,
  scheduleFollowUp,
  staleContacts,
  updateContact,
  type Contact,
} from '@/lib/network';
import { buildGcalLink } from '@/lib/gcal-link';
import {
  Card,
  confirmDialog,
  EmptyState,
  GhostButton,
  Modal,
  PrimaryButton,
  Seg,
  SectionTitle,
  TextInput,
} from './shared';

type Tab = 'cfa' | 'projects' | 'network';
const TABS: { value: Tab; label: string }[] = [
  { value: 'cfa', label: 'CFA' },
  { value: 'projects', label: 'Projects' },
  { value: 'network', label: 'Network' },
];

export default function ProjectsPanel({ accent }: { accent: BentoAccent }) {
  useStorageTick();
  const [tab, setTab] = React.useState<Tab>(() => {
    const saved = storeGet<Tab>('projects_active_tab');
    return saved && TABS.some((t) => t.value === saved) ? saved : 'cfa';
  });

  const switchTab = (t: Tab) => {
    setTab(t);
    storeSet('projects_active_tab', t);
  };

  return (
    <div className="flex flex-col gap-4 pb-2 pt-2">
      <Seg options={TABS} value={tab} onChange={switchTab} />
      {tab === 'cfa' && <CfaTab accent={accent} />}
      {tab === 'projects' && <ProjectsTab accent={accent} />}
      {tab === 'network' && <NetworkTab accent={accent} />}
    </div>
  );
}

// ============================ CFA tab =======================================

function CfaTab({ accent }: { accent: BentoAccent }) {
  useStorageTick();
  const progress = loadCfaProgress();
  const done = doneCount(progress);
  const total = CFA_READINGS.length;
  const pct = pctComplete(progress);
  const days = daysUntilExam();

  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const [slotsOpen, setSlotsOpen] = React.useState(false);
  const [slots, setSlots] = React.useState<StudySlotConfig>(() => loadStudySlots());
  const sessions = sessionsRemaining(slots);

  const [reviewTopic, setReviewTopic] = React.useState<CfaTopic | null>(null);
  const stale = mostStaleTopics(progress, 5);

  return (
    <div className="flex flex-col gap-4">
      {/* progress wheel */}
      <Card className="flex items-center gap-5">
        <div className="relative shrink-0">
          <MiniRing value={done} max={total} color={accent.from} size={72} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-[15px] font-bold tabular-nums text-ink">{pct}%</span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-ink-3">
            CFA Level I progress
          </div>
          <div className="mt-1 text-[13px] text-ink-2">
            {done} / {total} readings complete
          </div>
          <div className="mt-0.5 text-[11.5px] text-ink-3">
            Exam window ends {formatDateKey(EXAM_DATE)}
          </div>
        </div>
      </Card>

      {/* countdown + capacity */}
      <Card className="flex items-center justify-between gap-4">
        <div className="flex gap-6">
          <div>
            <div className="font-mono text-[22px] font-bold tabular-nums text-ink">{days}</div>
            <div className="mt-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
              days to exam
            </div>
          </div>
          <div>
            <div className="font-mono text-[22px] font-bold tabular-nums text-ink">{sessions}</div>
            <div className="mt-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
              study sessions left
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSlotsOpen(true)}
          className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[12px] font-semibold text-ink-2 transition-colors hover:bg-white/[0.09] hover:text-ink"
        >
          <Settings2 size={14} aria-hidden />
          Slots
        </button>
      </Card>

      {/* needs review */}
      <div>
        <SectionTitle>Needs review</SectionTitle>
        {stale.length === 0 ? (
          <EmptyState>No topics yet.</EmptyState>
        ) : (
          <div className="flex flex-col gap-1.5">
            {stale.map((topic) => (
              <div
                key={topic.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="h-[7px] w-[7px] shrink-0 rounded-full"
                    style={{ background: topic.color }}
                    aria-hidden
                  />
                  <span className="truncate text-[13px] font-medium text-ink">{topic.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setReviewTopic(topic)}
                  className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-2 transition-colors hover:bg-white/[0.09] hover:text-ink"
                >
                  <CalendarPlus size={13} aria-hidden />
                  Schedule review
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* topic tree */}
      <div>
        <SectionTitle>Topics</SectionTitle>
        <div className="flex flex-col gap-1.5">
          {CFA_TOPICS.map((topic) => {
            const readings = readingsForTopic(topic.id);
            const topicDone = readings.filter((r) => isDone(progress, r.id)).length;
            const isOpen = expanded.has(topic.id);
            return (
              <Card key={topic.id} className="p-0">
                <button
                  type="button"
                  onClick={() => toggleExpanded(topic.id)}
                  className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-3 text-left"
                >
                  {isOpen ? (
                    <ChevronDown size={15} className="shrink-0 text-ink-3" aria-hidden />
                  ) : (
                    <ChevronRight size={15} className="shrink-0 text-ink-3" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">
                    {topic.name}
                  </span>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[10.5px] font-bold tabular-nums"
                    style={{ background: `${topic.color}26`, color: topic.color }}
                  >
                    {topicDone}/{readings.length}
                  </span>
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-1 px-4 pb-3">
                    {readings.map((r) => {
                      const checked = isDone(progress, r.id);
                      return (
                        <label
                          key={r.id}
                          className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-white/[0.03]"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleReadingDone(r.id)}
                            className="h-[17px] w-[17px] shrink-0 cursor-pointer appearance-none rounded-[5px] border-[1.5px] border-white/20 bg-black/30 transition-all checked:shadow-[0_0_10px_rgba(99,102,241,0.4)]"
                            style={
                              checked
                                ? {
                                    borderColor: topic.color,
                                    background: topic.color,
                                    backgroundImage:
                                      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%230A0A0B' stroke-width='3.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E\")",
                                    backgroundSize: '11px',
                                    backgroundPosition: 'center',
                                    backgroundRepeat: 'no-repeat',
                                  }
                                : undefined
                            }
                          />
                          <span
                            className={cn(
                              'min-w-0 flex-1 truncate text-[12.5px]',
                              checked ? 'text-ink-3 line-through' : 'text-ink-2',
                            )}
                          >
                            M{r.num} · {r.name}
                          </span>
                        </label>
                      );
                    })}
                    <TopicNotes topic={topic} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      <StudySlotsModal
        open={slotsOpen}
        onClose={() => setSlotsOpen(false)}
        slots={slots}
        onChange={(next) => {
          setSlots(next);
          saveStudySlots(next);
        }}
      />
      <ReviewModal topic={reviewTopic} onClose={() => setReviewTopic(null)} />
    </div>
  );
}

const CONFIDENCE_LABELS = ['Weak', 'Shaky', 'OK', 'Solid', 'Strong'];

/** Per-topic weakness tracking: a 1-5 confidence self-rating plus free-text
 *  detail — the rating alone can't say *what* to review, the notes alone
 *  don't give an at-a-glance signal. Own local state so re-renders from
 *  other storage writes (e.g. a reading checkbox elsewhere) don't reset the
 *  textarea's cursor position. */
function TopicNotes({ topic }: { topic: CfaTopic }) {
  const [note, setNote] = React.useState(() => getTopicNote(topic.id));

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-white/[0.06] px-1.5 pt-2.5">
      <div className="flex items-center gap-3">
        <span className="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-ink-3">
          Confidence
        </span>
        <span className="w-9 shrink-0 text-right text-[11px] text-ink-3">Weak</span>
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={note.confidence}
          onChange={(e) => {
            const confidence = Number(e.target.value);
            setNote((n) => ({ ...n, confidence }));
            saveTopicNote(topic.id, { confidence });
          }}
          style={{ accentColor: topic.color }}
          className="h-1.5 flex-1 cursor-pointer"
          aria-label={`${topic.name} confidence`}
        />
        <span className="w-10 shrink-0 text-[11px] text-ink-3">Strong</span>
        <span
          className="w-11 shrink-0 rounded-full px-1.5 py-0.5 text-center font-mono text-[10px] font-bold"
          style={{ background: `${topic.color}26`, color: topic.color }}
        >
          {CONFIDENCE_LABELS[note.confidence - 1]}
        </span>
      </div>
      <textarea
        value={note.notes}
        onChange={(e) => {
          const notes = e.target.value;
          setNote((n) => ({ ...n, notes }));
          saveTopicNote(topic.id, { notes });
        }}
        rows={2}
        placeholder="Weaknesses, what to review…"
        className="w-full rounded-lg border border-white/[0.09] bg-black/25 px-3 py-2 text-[12px] text-ink outline-none transition-colors placeholder:text-ink-4 focus:border-white/25 focus:bg-black/35"
      />
    </div>
  );
}

// ============================ study slots modal =============================

function StudySlotsModal({
  open,
  onClose,
  slots,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  slots: StudySlotConfig;
  onChange: (next: StudySlotConfig) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Study slots" maxWidth={380}>
      <p className="mb-3 text-[12.5px] text-ink-3">
        Which slots count toward "study sessions remaining" — 9:30am–6pm weekdays is work,
        so evenings and weekends are the real capacity.
      </p>
      <div className="flex flex-col gap-2">
        {STUDY_SLOTS.map(({ id, label }: { id: StudySlot; label: string }) => (
          <label
            key={id}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 text-[13px] text-ink-2"
          >
            <input
              type="checkbox"
              checked={slots[id]}
              onChange={(e) => onChange({ ...slots, [id]: e.target.checked })}
              className="h-[16px] w-[16px] cursor-pointer"
            />
            {label}
          </label>
        ))}
      </div>
      <GhostButton className="mt-4 w-full justify-center" onClick={onClose}>
        Done
      </GhostButton>
    </Modal>
  );
}

// ============================ review-block modal =============================

function ReviewModal({ topic, onClose }: { topic: CfaTopic | null; onClose: () => void }) {
  const [date, setDate] = React.useState('');
  const [start, setStart] = React.useState('19:00');
  const [end, setEnd] = React.useState('20:00');

  React.useEffect(() => {
    if (!topic) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setDate(tomorrow.toISOString().slice(0, 10));
    setStart('19:00');
    setEnd('20:00');
  }, [topic]);

  if (!topic) return null;

  const title = `Review: ${topic.name}`;
  const startDate = date && start ? new Date(`${date}T${start}:00`) : null;
  const endDate = date && end ? new Date(`${date}T${end}:00`) : null;
  const valid = startDate && endDate && endDate.getTime() > startDate.getTime();

  const confirm = () => {
    if (!valid || !startDate || !endDate) return;
    const url = buildGcalLink(title, startDate, endDate, 'CFA Level I review block');
    window.open(url, '_blank', 'noopener,noreferrer');
    markTopicReviewed(topic.id);
    onClose();
  };

  return (
    <Modal open={!!topic} onClose={onClose} title="Schedule review" maxWidth={420}>
      <div className="mb-4 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="mb-1 block text-[11.5px] font-medium text-ink-3">Date</label>
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-medium text-ink-3">Start</label>
            <TextInput type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-medium text-ink-3">End</label>
            <TextInput type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-black/25 px-3.5 py-3">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
            About to create
          </div>
          <div className="mt-1.5 text-[13px] font-medium text-ink">{title}</div>
          <div className="mt-0.5 text-[12px] text-ink-3">
            {valid && startDate && endDate
              ? `${startDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${start}–${end}`
              : 'Pick a valid date and time range'}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <PrimaryButton className="flex-1 justify-center" disabled={!valid} onClick={confirm}>
          <CalendarPlus size={14} aria-hidden className="mr-1.5 inline" />
          Add to Google Calendar
        </PrimaryButton>
        <GhostButton onClick={onClose}>Cancel</GhostButton>
      </div>
    </Modal>
  );
}

function relTime(ms: number): string {
  const diff = Date.now() - ms;
  const day = 86_400_000;
  if (diff < 3_600_000) return 'just now';
  if (diff < day) return `${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / day);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ============================ Projects tab ==================================

const STATUS_META: Record<ProjectStatus, { label: string }> = {
  active: { label: 'Active' },
  paused: { label: 'Paused' },
  shipped: { label: 'Shipped' },
};

const STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'shipped', label: 'Shipped' },
];

function statusColor(status: ProjectStatus, accent: BentoAccent): string {
  if (status === 'active') return 'var(--color-good)';
  if (status === 'paused') return 'var(--color-warn)';
  return accent.from; // shipped — the box's own accent, a distinct "done" signal
}

function ProjectsTab({ accent }: { accent: BentoAccent }) {
  useStorageTick();
  const all = loadProjects();
  const [showArchived, setShowArchived] = React.useState(false);
  const visible = showArchived ? all : all.filter((p) => !p.archived);

  const [editing, setEditing] = React.useState<ProjectEntry | 'new' | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <SectionTitle className="mb-0 flex-1">Active projects</SectionTitle>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className={cn(
              'cursor-pointer rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors',
              showArchived
                ? 'border-white/15 bg-white/[0.08] text-ink'
                : 'border-white/10 bg-white/[0.04] text-ink-3 hover:text-ink-2',
            )}
          >
            {showArchived ? 'Hide archived' : 'Show archived'}
          </button>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-2 transition-colors hover:bg-white/[0.09] hover:text-ink"
          >
            <Plus size={13} aria-hidden />
            Add project
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState>No projects yet — add one to start tracking.</EmptyState>
      ) : (
        <div className="flex flex-col gap-1.5">
          {visible.map((p) => (
            <div
              key={p.id}
              className={cn(
                'flex items-start gap-3 rounded-2xl bg-white/[0.035] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_34px_rgba(0,0,0,0.4)] transition-colors',
                overId === p.id && dragId != null && dragId !== p.id
                  ? 'border-t-2 border-t-good'
                  : '',
                p.archived ? 'opacity-55' : '',
              )}
              draggable={!p.archived && !showArchived}
              onDragStart={() => setDragId(p.id)}
              onDragOver={(e: React.DragEvent) => {
                e.preventDefault();
                setOverId(p.id);
              }}
              onDragLeave={() => setOverId(null)}
              onDrop={(e: React.DragEvent) => {
                e.preventDefault();
                if (dragId) reorderProjects(dragId, p.id);
                setDragId(null);
                setOverId(null);
              }}
            >
              {!p.archived && !showArchived ? (
                <span className="mt-0.5 shrink-0 cursor-grab text-ink-4 active:cursor-grabbing">
                  <GripVertical size={14} aria-hidden />
                </span>
              ) : (
                <span className="mt-0.5 w-[14px] shrink-0" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[13.5px] font-semibold text-ink">{p.name}</span>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em]"
                    style={{
                      background: `${statusColor(p.status, accent)}26`,
                      color: statusColor(p.status, accent),
                    }}
                  >
                    {STATUS_META[p.status].label}
                  </span>
                </div>
                {p.notes && (
                  <p className="mt-1 line-clamp-2 text-[12px] text-ink-3">{p.notes}</p>
                )}
                <div className="mt-1.5 font-mono text-[10.5px] text-ink-4">
                  updated {relTime(p.updatedAt)}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => setEditing(p)}
                  aria-label="Edit project"
                  className="cursor-pointer rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink"
                >
                  <Pencil size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => toggleArchive(p.id)}
                  aria-label={p.archived ? 'Unarchive project' : 'Archive project'}
                  className="cursor-pointer rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink"
                >
                  {p.archived ? <ArchiveRestore size={14} aria-hidden /> : <Archive size={14} aria-hidden />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ProjectModal
        project={editing}
        onClose={() => setEditing(null)}
        accent={accent}
      />
    </div>
  );
}

function ProjectModal({
  project,
  onClose,
  accent,
}: {
  project: ProjectEntry | 'new' | null;
  onClose: () => void;
  accent: BentoAccent;
}) {
  const isNew = project === 'new';
  const existing = project && project !== 'new' ? project : null;

  const [name, setName] = React.useState('');
  const [status, setStatus] = React.useState<ProjectStatus>('active');
  const [notes, setNotes] = React.useState('');

  React.useEffect(() => {
    if (!project) return;
    setName(existing?.name ?? '');
    setStatus(existing?.status ?? 'active');
    setNotes(existing?.notes ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  if (!project) return null;

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (isNew) {
      addProject(trimmed, status);
    } else if (existing) {
      updateProject(existing.id, { name: trimmed, status, notes });
    }
    onClose();
  };

  const remove = () => {
    if (!existing) return;
    if (!confirmDialog(`Delete "${existing.name}"? This can't be undone.`)) return;
    deleteProject(existing.id);
    onClose();
  };

  return (
    <Modal open={!!project} onClose={onClose} title={isNew ? 'Add project' : 'Edit project'} maxWidth={420}>
      <div className="mb-4 flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-[11.5px] font-medium text-ink-3">Name</label>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. WHOOP dashboard" />
        </div>
        <div>
          <label className="mb-1.5 block text-[11.5px] font-medium text-ink-3">Status</label>
          <Seg options={STATUS_OPTIONS} value={status} onChange={setStatus} />
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] font-medium text-ink-3">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="What's next, blockers, ideas…"
            className="w-full rounded-xl border border-white/[0.09] bg-black/30 px-3.5 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-white/30 focus:bg-black/40"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <PrimaryButton className="flex-1 justify-center" disabled={!name.trim()} onClick={save}>
          {isNew ? 'Add' : 'Save'}
        </PrimaryButton>
        {existing && (
          <button
            type="button"
            onClick={remove}
            aria-label="Delete project"
            className="cursor-pointer rounded-xl border border-bad/30 px-3 text-bad transition-colors hover:bg-bad/10"
          >
            <Trash2 size={15} aria-hidden />
          </button>
        )}
        <GhostButton onClick={onClose}>Cancel</GhostButton>
      </div>
    </Modal>
  );
}

// ============================ Network tab ====================================

function NetworkTab({ accent }: { accent: BentoAccent }) {
  useStorageTick();
  const contacts = loadContacts();
  const staleWeeks = loadStaleWeeks();
  const cold = staleContacts(contacts, staleWeeks);

  const [editing, setEditing] = React.useState<Contact | 'new' | null>(null);
  const [followUpFor, setFollowUpFor] = React.useState<Contact | null>(null);
  const [weeksOpen, setWeeksOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <SectionTitle
          right={
            <button
              type="button"
              onClick={() => setWeeksOpen(true)}
              className="flex cursor-pointer items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[10.5px] font-semibold text-ink-3 transition-colors hover:text-ink"
            >
              <Settings2 size={12} aria-hidden />
              {staleWeeks}w window
            </button>
          }
        >
          Going cold
        </SectionTitle>
        {cold.length === 0 ? (
          <EmptyState>Nobody's gone quiet — nice.</EmptyState>
        ) : (
          <div className="flex flex-col gap-1.5">
            {cold.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-warn/25 bg-warn/[0.06] px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-ink">
                    {c.name}
                    {c.company && <span className="text-ink-3"> · {c.company}</span>}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-warn">
                    {c.lastContactDate ? `last contact ${formatDateKey(c.lastContactDate)}` : 'never contacted'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setFollowUpFor(c)}
                  className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-2 transition-colors hover:bg-white/[0.09] hover:text-ink"
                >
                  <CalendarPlus size={13} aria-hidden />
                  Schedule follow-up
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle className="mb-0 flex-1">All contacts</SectionTitle>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-2 transition-colors hover:bg-white/[0.09] hover:text-ink"
          >
            <UserPlus size={13} aria-hidden />
            Add contact
          </button>
        </div>
        {contacts.length === 0 ? (
          <EmptyState>No contacts yet — add your first networking contact.</EmptyState>
        ) : (
          <div className="flex flex-col gap-1.5">
            {contacts.map((c) => (
              <Card key={c.id} className="flex items-start gap-3 p-3.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold text-ink">{c.name}</div>
                  <div className="truncate text-[12px] text-ink-2">
                    {[c.role, c.company].filter(Boolean).join(' · ') || '—'}
                  </div>
                  {c.notes && <p className="mt-1 line-clamp-2 text-[12px] text-ink-3">{c.notes}</p>}
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10.5px] text-ink-4">
                    <span>last: {c.lastContactDate ? formatDateKey(c.lastContactDate) : 'never'}</span>
                    <span>next: {c.nextFollowUpDate ? formatDateKey(c.nextFollowUpDate) : '—'}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(c)}
                    aria-label="Edit contact"
                    className="cursor-pointer rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-white/[0.06] hover:text-ink"
                  >
                    <Pencil size={14} aria-hidden />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <ContactModal contact={editing} onClose={() => setEditing(null)} />
      <FollowUpModal contact={followUpFor} onClose={() => setFollowUpFor(null)} />
      <StaleWeeksModal
        open={weeksOpen}
        onClose={() => setWeeksOpen(false)}
        weeks={staleWeeks}
        onChange={saveStaleWeeks}
      />
    </div>
  );
}

function ContactModal({ contact, onClose }: { contact: Contact | 'new' | null; onClose: () => void }) {
  const isNew = contact === 'new';
  const existing = contact && contact !== 'new' ? contact : null;

  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState('');
  const [company, setCompany] = React.useState('');
  const [lastContactDate, setLastContactDate] = React.useState('');
  const [nextFollowUpDate, setNextFollowUpDate] = React.useState('');
  const [notes, setNotes] = React.useState('');

  React.useEffect(() => {
    if (!contact) return;
    setName(existing?.name ?? '');
    setRole(existing?.role ?? '');
    setCompany(existing?.company ?? '');
    setLastContactDate(existing?.lastContactDate ?? '');
    setNextFollowUpDate(existing?.nextFollowUpDate ?? '');
    setNotes(existing?.notes ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact]);

  if (!contact) return null;

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const data = {
      name: trimmed,
      role: role.trim(),
      company: company.trim(),
      lastContactDate: lastContactDate || null,
      nextFollowUpDate: nextFollowUpDate || null,
      notes: notes.trim(),
    };
    if (isNew) addContact(data);
    else if (existing) updateContact(existing.id, data);
    onClose();
  };

  const remove = () => {
    if (!existing) return;
    if (!confirmDialog(`Delete "${existing.name}"? This can't be undone.`)) return;
    deleteContact(existing.id);
    onClose();
  };

  return (
    <Modal open={!!contact} onClose={onClose} title={isNew ? 'Add contact' : 'Edit contact'} maxWidth={440}>
      <div className="mb-4 flex flex-col gap-3">
        <div>
          <label className="mb-1 block text-[11.5px] font-medium text-ink-3">Name</label>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sarah Chen" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11.5px] font-medium text-ink-3">Role</label>
            <TextInput value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. VP, S&T" />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-medium text-ink-3">Company</label>
            <TextInput value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Goldman Sachs" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-[11.5px] font-medium text-ink-3">Last contact</label>
            <TextInput
              type="date"
              value={lastContactDate}
              onChange={(e) => setLastContactDate(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-medium text-ink-3">Next follow-up</label>
            <TextInput
              type="date"
              value={nextFollowUpDate}
              onChange={(e) => setNextFollowUpDate(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11.5px] font-medium text-ink-3">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Context, intro source, talking points…"
            className="w-full rounded-xl border border-white/[0.09] bg-black/30 px-3.5 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-white/30 focus:bg-black/40"
          />
        </div>
      </div>
      <div className="flex gap-2">
        <PrimaryButton className="flex-1 justify-center" disabled={!name.trim()} onClick={save}>
          {isNew ? 'Add' : 'Save'}
        </PrimaryButton>
        {existing && (
          <button
            type="button"
            onClick={remove}
            aria-label="Delete contact"
            className="cursor-pointer rounded-xl border border-bad/30 px-3 text-bad transition-colors hover:bg-bad/10"
          >
            <Trash2 size={15} aria-hidden />
          </button>
        )}
        <GhostButton onClick={onClose}>Cancel</GhostButton>
      </div>
    </Modal>
  );
}

function FollowUpModal({ contact, onClose }: { contact: Contact | null; onClose: () => void }) {
  const [date, setDate] = React.useState('');
  const [start, setStart] = React.useState('09:00');
  const [end, setEnd] = React.useState('09:30');

  React.useEffect(() => {
    if (!contact) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setDate(tomorrow.toISOString().slice(0, 10));
    setStart('09:00');
    setEnd('09:30');
  }, [contact]);

  if (!contact) return null;

  const title = `Follow up: ${contact.name}${contact.company ? ` (${contact.company})` : ''}`;
  const startDate = date && start ? new Date(`${date}T${start}:00`) : null;
  const endDate = date && end ? new Date(`${date}T${end}:00`) : null;
  const valid = startDate && endDate && endDate.getTime() > startDate.getTime();

  const confirm = () => {
    if (!valid || !startDate || !endDate || !date) return;
    const url = buildGcalLink(title, startDate, endDate, 'Networking follow-up');
    window.open(url, '_blank', 'noopener,noreferrer');
    scheduleFollowUp(contact.id, date);
    onClose();
  };

  return (
    <Modal open={!!contact} onClose={onClose} title="Schedule follow-up" maxWidth={420}>
      <div className="mb-4 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="mb-1 block text-[11.5px] font-medium text-ink-3">Date</label>
            <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-medium text-ink-3">Start</label>
            <TextInput type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[11.5px] font-medium text-ink-3">End</label>
            <TextInput type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-black/25 px-3.5 py-3">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3">
            About to create
          </div>
          <div className="mt-1.5 text-[13px] font-medium text-ink">{title}</div>
          <div className="mt-0.5 text-[12px] text-ink-3">
            {valid && startDate && endDate
              ? `${startDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${start}–${end}`
              : 'Pick a valid date and time range'}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <PrimaryButton className="flex-1 justify-center" disabled={!valid} onClick={confirm}>
          <CalendarPlus size={14} aria-hidden className="mr-1.5 inline" />
          Add to Google Calendar
        </PrimaryButton>
        <GhostButton onClick={onClose}>Cancel</GhostButton>
      </div>
    </Modal>
  );
}

function StaleWeeksModal({
  open,
  onClose,
  weeks,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  weeks: number;
  onChange: (n: number) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Going-cold window" maxWidth={340}>
      <p className="mb-3 text-[12.5px] text-ink-3">
        Contacts with no logged contact in this many weeks (or never contacted) show up under
        "Going cold."
      </p>
      <div className="mb-4 flex items-center gap-3">
        <input
          type="number"
          min={1}
          max={52}
          value={weeks}
          onChange={(e) => onChange(Math.max(1, Math.min(52, Number(e.target.value) || 1)))}
          className="w-20 rounded-xl border border-white/[0.09] bg-black/30 px-3 py-2 text-[14px] text-ink outline-none focus:border-white/30"
        />
        <span className="text-[13px] text-ink-2">weeks</span>
      </div>
      <GhostButton className="w-full justify-center" onClick={onClose}>
        Done
      </GhostButton>
    </Modal>
  );
}
