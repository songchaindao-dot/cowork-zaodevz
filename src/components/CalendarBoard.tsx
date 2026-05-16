"use client";

import { useState, useMemo, useTransition } from "react";
import type {
  RecurringTaskDef,
  RecurrenceType,
  Priority,
  Phase,
  ActionItem,
  ActionStatus,
} from "@/lib/types";
import {
  computeNextRun,
  getSpawnsInRange,
  recurrenceDescription,
  deadlineUrgency,
  CATEGORIES,
  PRIORITIES,
  PHASES,
  STATUSES,
  RECURRENCE_TYPES,
  RECURRENCE_LABELS,
  DAY_NAMES_SHORT,
  MONTH_NAMES_FULL,
  DEV_CATEGORIES,
  MUSIC_CATEGORIES,
  MARKETING_CATEGORIES,
} from "@/lib/types";
import {
  createItem,
  createRecurringDef,
  updateRecurringDef,
  deleteRecurringDef,
  toggleRecurringDef,
  triggerSpawn,
} from "@/app/actions";
import { UserPicker, usersToAssignment, assignmentToUsers } from "@/components/UserPicker";
import { TaskRoom } from "@/components/TaskRoom";

// ── Type definitions ───────────────────────────────────────────────────────

type DefFormState = {
  id?: string;
  title: string;
  category: string;
  priority: Priority;
  users: string[];
  recurrence: RecurrenceType;
  daysOfWeek: number[];
  dayOfMonth: number;
  yearlyMonth: number;
  yearlyDay: number;
  notes: string;
  phase: Phase;
  requiresApproval: boolean;
  active: boolean;
};

type TaskFormState = {
  title: string;
  category: string;
  priority: Priority;
  status: ActionStatus;
  users: string[];   // multi-user selection → mapped to owner + assignees on submit
  due: string;
  notes: string;
};

// ── Pure helpers ───────────────────────────────────────────────────────────

function emptyDefForm(): DefFormState {
  return {
    title: "", category: "Ops", priority: "P2", users: ["Zaal", "Iman"],
    recurrence: "weekly", daysOfWeek: [1], dayOfMonth: 1,
    yearlyMonth: 1, yearlyDay: 1, notes: "", phase: "Define",
    requiresApproval: false, active: true,
  };
}

function defToForm(def: RecurringTaskDef): DefFormState {
  return {
    id: def.id, title: def.title, category: String(def.category),
    priority: def.priority, users: assignmentToUsers(String(def.owner)), recurrence: def.recurrence,
    daysOfWeek: def.daysOfWeek?.length ? def.daysOfWeek : [1],
    dayOfMonth: def.dayOfMonth || 1, yearlyMonth: def.yearlyMonth || 1,
    yearlyDay: def.yearlyDay || 1, notes: def.notes || "", phase: def.phase || "Define",
    requiresApproval: def.requiresApproval || false, active: def.active,
  };
}

function defFormToFD(s: DefFormState): FormData {
  const fd = new FormData();
  if (s.id) fd.append("id", s.id);
  fd.append("title", s.title); fd.append("category", s.category);
  const { owner } = usersToAssignment(s.users);
  fd.append("priority", s.priority); fd.append("owner", owner);
  fd.append("recurrence", s.recurrence);
  if (s.recurrence === "weekly") s.daysOfWeek.forEach((d) => fd.append("daysOfWeek", String(d)));
  if (s.recurrence === "monthly") fd.append("dayOfMonth", String(s.dayOfMonth));
  if (s.recurrence === "yearly") { fd.append("yearlyMonth", String(s.yearlyMonth)); fd.append("yearlyDay", String(s.yearlyDay)); }
  fd.append("notes", s.notes); fd.append("phase", s.phase);
  fd.append("_hasRequiresApproval", "1");
  fd.append("requiresApproval", s.requiresApproval ? "true" : "false");
  fd.append("active", s.active ? "true" : "false");
  return fd;
}

function defDot(cat: string): string {
  if (DEV_CATEGORIES.includes(cat)) return "bg-blue-400";
  if (MUSIC_CATEGORIES.includes(cat)) return "bg-purple-400";
  if (MARKETING_CATEGORIES.includes(cat)) return "bg-amber-400";
  return "bg-slate-400";
}

function defRingColor(cat: string): string {
  if (DEV_CATEGORIES.includes(cat)) return "ring-blue-500/40";
  if (MUSIC_CATEGORIES.includes(cat)) return "ring-purple-500/40";
  if (MARKETING_CATEGORIES.includes(cat)) return "ring-amber-500/40";
  return "ring-slate-500/40";
}

function calendarGrid(year: number, month: number): (number | null)[] {
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (number | null)[] = Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function priorityDot(p: Priority): string {
  return p === "P1" ? "bg-red-400" : p === "P2" ? "bg-amber-400" : "bg-emerald-400";
}

function statusStyle(s: ActionStatus): string {
  if (s === "WIP") return "text-blue-300 bg-blue-500/10 border-blue-500/20";
  if (s === "BLOCKED") return "text-red-400 bg-red-500/10 border-red-500/20";
  return "text-white/40 bg-white/5 border-white/10";
}

function defaultUsersForCurrentUser(user: string): string[] {
  if (user === "zaal") return ["Zaal"];
  if (user === "iman") return ["Iman"];
  if (user === "thyrev") return ["ThyRev"];
  return [];
}

function emptyTaskForm(due: string, user: string): TaskFormState {
  return {
    title: "", category: "Ops", priority: "P2", status: "TODO",
    users: defaultUsersForCurrentUser(user), due, notes: "",
  };
}

function formatDayHeading(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", timeZone: "UTC",
  });
}

function isOverdue(due: string, today: string): boolean {
  return due < today;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function CalTaskCard({ item, today, onOpen }: { item: ActionItem; today: string; onOpen: (id: string) => void }) {
  const overdue = isOverdue(item.due, today);
  const urgency = deadlineUrgency(item.due);
  const dueCls =
    urgency === "overdue" ? "text-red-400" :
    urgency === "critical" ? "text-orange-400" :
    urgency === "soon" ? "text-amber-400" : "text-white/35";

  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      className="w-full text-left flex items-start gap-3 rounded-xl bg-white/[0.04] border border-white/[0.08] px-3 py-2.5 hover:bg-white/[0.08] hover:border-white/[0.15] transition-colors cursor-pointer"
    >
      <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${priorityDot(item.priority)}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white/90 truncate leading-snug">{item.title}</p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${statusStyle(item.status)}`}>
            {item.status}
          </span>
          <span className="text-[10px] text-white/35 truncate max-w-[120px]">{String(item.category)}</span>
          {item.owner && (
            <span className="text-[10px] text-white/25">· {String(item.owner)}</span>
          )}
          {overdue && (
            <span className={`text-[10px] font-medium ${dueCls}`}>overdue</span>
          )}
        </div>
      </div>
      <span className="text-[10px] text-white/25 flex-shrink-0 mt-1">open →</span>
    </button>
  );
}

function CreateTaskModal({
  form,
  setForm,
  lead,
  onClose,
  onSave,
  pending,
}: {
  form: TaskFormState;
  setForm: (f: TaskFormState) => void;
  lead: boolean;
  onClose: () => void;
  onSave: () => void;
  pending: boolean;
}) {
  const set = <K extends keyof TaskFormState>(k: K, v: TaskFormState[K]) =>
    setForm({ ...form, [k]: v });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl bg-[#07111e] border border-white/[0.12] shadow-2xl overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <h2 className="font-semibold text-white text-sm">Add Task to Calendar</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white/70 text-lg leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs text-white/50 mb-1">Title *</label>
            <input
              autoFocus
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && form.title.trim() && onSave()}
              placeholder="What needs to be done?"
              className="w-full rounded-lg bg-[#0b1220] border border-white/[0.1] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50"
            />
          </div>

          {/* Due date */}
          <div>
            <label className="block text-xs text-white/50 mb-1">Due date</label>
            <input
              type="date"
              value={form.due}
              onChange={(e) => set("due", e.target.value)}
              className="w-full rounded-lg bg-[#0b1220] border border-white/[0.1] px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
            />
          </div>

          {/* Category + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/50 mb-1">Category</label>
              <select
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
                className="w-full rounded-lg bg-[#0b1220] border border-white/[0.1] px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">Priority</label>
              <div className="flex gap-1.5">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => set("priority", p)}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${
                      form.priority === p
                        ? p === "P1" ? "bg-red-500/20 border-red-500/50 text-red-200"
                        : p === "P2" ? "bg-amber-500/20 border-amber-500/50 text-amber-200"
                        : "bg-emerald-500/20 border-emerald-500/50 text-emerald-200"
                        : "border-white/10 text-white/40 hover:text-white/70 hover:bg-white/5"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Status */}
          <div>
            <label className="block text-xs text-white/50 mb-1">Status</label>
            <div className="flex gap-1.5 flex-wrap">
              {(["TODO", "WIP", "BLOCKED"] as ActionStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set("status", s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    form.status === s
                      ? s === "WIP" ? "bg-blue-500/20 border-blue-500/40 text-blue-200"
                      : s === "BLOCKED" ? "bg-red-500/20 border-red-500/40 text-red-200"
                      : "bg-white/10 border-white/20 text-white/80"
                      : "border-white/10 text-white/40 hover:text-white/70 hover:bg-white/5"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Assigned to — multi-user picker */}
          <div>
            <UserPicker
              value={form.users}
              onChange={(users) => set("users", users)}
              disabled={pending}
              label="Assigned to"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-white/50 mb-1">Notes</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Optional"
              className="w-full rounded-lg bg-[#0b1220] border border-white/[0.1] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50 resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/[0.08]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs text-white/50 hover:text-white/80 border border-white/10 rounded-lg hover:bg-white/5 transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!form.title.trim() || pending}
            onClick={onSave}
            className="px-4 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white rounded-lg transition-all"
          >
            {pending ? "Adding…" : "Add Task"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DefFormModal({
  form,
  setForm,
  onClose,
  onSave,
  pending,
}: {
  form: DefFormState;
  setForm: (f: DefFormState) => void;
  onClose: () => void;
  onSave: () => void;
  pending: boolean;
}) {
  const set = <K extends keyof DefFormState>(k: K, v: DefFormState[K]) =>
    setForm({ ...form, [k]: v });
  const toggleDay = (d: number) => {
    const cur = form.daysOfWeek;
    set("daysOfWeek", cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-2xl bg-[#07111e] border border-white/[0.12] shadow-2xl overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <h2 className="font-semibold text-white text-sm">
            {form.id ? "Edit Recurring Task" : "New Recurring Task"}
          </h2>
          <button onClick={onClose} className="text-white/40 hover:text-white/70 text-lg leading-none">×</button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-white/50 mb-1">Title *</label>
            <input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Weekly team check-in"
              className="w-full rounded-lg bg-[#0b1220] border border-white/[0.1] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50"
            />
          </div>

          <div>
            <label className="block text-xs text-white/50 mb-1">Category</label>
            <select value={form.category} onChange={(e) => set("category", e.target.value)}
              className="w-full rounded-lg bg-[#0b1220] border border-white/[0.1] px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <UserPicker
            value={form.users}
            onChange={(users) => set("users", users)}
            disabled={pending}
            label="Assign to"
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/50 mb-1">Priority</label>
              <select value={form.priority} onChange={(e) => set("priority", e.target.value as Priority)}
                className="w-full rounded-lg bg-[#0b1220] border border-white/[0.1] px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50">
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">Phase</label>
              <select value={form.phase} onChange={(e) => set("phase", e.target.value as Phase)}
                className="w-full rounded-lg bg-[#0b1220] border border-white/[0.1] px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50">
                {PHASES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-white/50 mb-1">Recurrence</label>
            <div className="flex gap-2 flex-wrap">
              {RECURRENCE_TYPES.map((rt) => (
                <button key={rt} type="button" onClick={() => set("recurrence", rt)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                    form.recurrence === rt
                      ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-200"
                      : "border-white/10 text-white/50 hover:text-white/70 hover:bg-white/5"
                  }`}>
                  {RECURRENCE_LABELS[rt]}
                </button>
              ))}
            </div>
          </div>

          {form.recurrence === "weekly" && (
            <div>
              <label className="block text-xs text-white/50 mb-2">Days of week</label>
              <div className="flex gap-1.5 flex-wrap">
                {DAY_NAMES_SHORT.map((name, i) => (
                  <button key={i} type="button" onClick={() => toggleDay(i)}
                    className={`w-10 h-9 rounded-lg text-xs font-medium border transition-all ${
                      form.daysOfWeek.includes(i)
                        ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-200"
                        : "border-white/10 text-white/40 hover:text-white/70 hover:bg-white/5"
                    }`}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {form.recurrence === "monthly" && (
            <div className="max-w-[120px]">
              <label className="block text-xs text-white/50 mb-1">Day of month</label>
              <input type="number" min={1} max={31} value={form.dayOfMonth}
                onChange={(e) => set("dayOfMonth", Math.min(31, Math.max(1, Number(e.target.value))))}
                className="w-full rounded-lg bg-[#0b1220] border border-white/[0.1] px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
            </div>
          )}
          {form.recurrence === "yearly" && (
            <div className="grid grid-cols-2 gap-3 max-w-xs">
              <div>
                <label className="block text-xs text-white/50 mb-1">Month</label>
                <select value={form.yearlyMonth} onChange={(e) => set("yearlyMonth", Number(e.target.value))}
                  className="w-full rounded-lg bg-[#0b1220] border border-white/[0.1] px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50">
                  {MONTH_NAMES_FULL.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Day</label>
                <input type="number" min={1} max={31} value={form.yearlyDay}
                  onChange={(e) => set("yearlyDay", Math.min(31, Math.max(1, Number(e.target.value))))}
                  className="w-full rounded-lg bg-[#0b1220] border border-white/[0.1] px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs text-white/50 mb-1">Notes</label>
            <textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)}
              placeholder="Optional description for spawned tasks"
              className="w-full rounded-lg bg-[#0b1220] border border-white/[0.1] px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-cyan-500/50 resize-none" />
          </div>

          <div className="flex gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer select-none">
              <input type="checkbox" checked={form.requiresApproval}
                onChange={(e) => set("requiresApproval", e.target.checked)} className="rounded" />
              Requires approval
            </label>
            <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer select-none">
              <input type="checkbox" checked={form.active}
                onChange={(e) => set("active", e.target.checked)} className="rounded" />
              Active
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/[0.08]">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-xs text-white/50 hover:text-white/80 border border-white/10 rounded-lg hover:bg-white/5 transition-all">
            Cancel
          </button>
          <button type="button" disabled={!form.title.trim() || pending} onClick={onSave}
            className="px-4 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white rounded-lg transition-all">
            {pending ? "Saving…" : form.id ? "Save Changes" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export function CalendarBoard({
  defs: initialDefs,
  lead,
  myTasks,
  currentUser,
}: {
  defs: RecurringTaskDef[];
  lead: boolean;
  myTasks: ActionItem[];
  currentUser: string;
}) {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [defForm, setDefForm] = useState<DefFormState | null>(null);
  const [taskForm, setTaskForm] = useState<TaskFormState | null>(null);
  const [taskRoomId, setTaskRoomId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const displayYear =
    today.getUTCFullYear() + Math.floor((today.getUTCMonth() + monthOffset) / 12);
  const displayMonth = ((today.getUTCMonth() + monthOffset) % 12 + 12) % 12;

  const monthStart = new Date(Date.UTC(displayYear, displayMonth, 1));
  const monthEnd = new Date(Date.UTC(displayYear, displayMonth + 1, 0));

  // Task map: due-date → ActionItem[]
  const taskMap = useMemo(() => {
    const map = new Map<string, ActionItem[]>();
    for (const item of myTasks) {
      if (!item.due) continue;
      if (!map.has(item.due)) map.set(item.due, []);
      map.get(item.due)!.push(item);
    }
    return map;
  }, [myTasks]);

  const spawnMap = useMemo(
    () => getSpawnsInRange(initialDefs, monthStart, monthEnd),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialDefs, displayYear, displayMonth],
  );

  const cells = calendarGrid(displayYear, displayMonth);

  // Upcoming 14 days
  const upcomingEnd = new Date(Date.UTC(
    today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 14,
  ));
  const upcomingSpawnMap = useMemo(
    () => getSpawnsInRange(initialDefs, today, upcomingEnd),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [initialDefs],
  );

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }

  function handleDayClick(dateStr: string) {
    setSelectedDay((prev) => (prev === dateStr ? null : dateStr));
  }

  function handleAddTask(due?: string) {
    setTaskForm(emptyTaskForm(due || selectedDay || todayStr, currentUser));
  }

  function handleSaveTask() {
    if (!taskForm) return;
    const { owner, assignees } = usersToAssignment(taskForm.users);
    const fd = new FormData();
    fd.append("title", taskForm.title);
    fd.append("category", taskForm.category);
    fd.append("priority", taskForm.priority);
    fd.append("status", taskForm.status);
    fd.append("owner", owner);
    assignees.forEach((a) => fd.append("assignees", a));
    fd.append("due", taskForm.due);
    fd.append("notes", taskForm.notes);
    fd.append("important", "false");
    fd.append("urgent", "false");
    startTransition(async () => {
      await createItem(fd);
      showToast("Task added to calendar.");
      setTaskForm(null);
    });
  }

  function handleSaveDef() {
    if (!defForm) return;
    const fd = defFormToFD(defForm);
    startTransition(async () => {
      if (defForm.id) {
        await updateRecurringDef(fd);
        showToast("Recurring task updated.");
      } else {
        await createRecurringDef(fd);
        showToast("Recurring task created.");
      }
      setDefForm(null);
    });
  }

  function handleDeleteDef(def: RecurringTaskDef) {
    if (!confirm(`Delete recurring task "${def.title}"? This cannot be undone.`)) return;
    const fd = new FormData();
    fd.append("id", def.id);
    startTransition(async () => {
      await deleteRecurringDef(fd);
      showToast("Recurring task deleted.");
    });
  }

  function handleToggleDef(def: RecurringTaskDef) {
    const fd = new FormData();
    fd.append("id", def.id);
    startTransition(async () => { await toggleRecurringDef(fd); });
  }

  function handleSpawnNow() {
    startTransition(async () => {
      const result = await triggerSpawn();
      showToast(
        result.spawned > 0
          ? `Spawned ${result.spawned} task${result.spawned === 1 ? "" : "s"}.`
          : "No tasks due right now.",
      );
    });
  }

  const selectedDayTasks = selectedDay ? (taskMap.get(selectedDay) || []) : [];
  const selectedDaySpawns = selectedDay ? (spawnMap.get(selectedDay) || []) : [];

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-cyan-900/90 border border-cyan-500/40 text-cyan-100 text-sm shadow-xl pointer-events-none">
          {toast}
        </div>
      )}

      {/* ── Calendar ────────────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white/[0.04] backdrop-blur-xl border border-white/10 p-4 md:p-5">
        {/* Month nav */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setMonthOffset((o) => o - 1)}
              className="p-1.5 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/10 transition-all text-lg leading-none">‹</button>
            <span className="text-sm font-semibold text-white min-w-[150px] text-center">
              {MONTH_NAMES_FULL[displayMonth]} {displayYear}
            </span>
            <button onClick={() => setMonthOffset((o) => o + 1)}
              className="p-1.5 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/10 transition-all text-lg leading-none">›</button>
            {monthOffset !== 0 && (
              <button onClick={() => { setMonthOffset(0); setSelectedDay(null); }}
                className="text-xs text-white/30 hover:text-white/60 underline">today</button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleAddTask()}
              disabled={pending}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/[0.06] hover:bg-white/[0.10] border border-white/10 text-white/70 disabled:opacity-40 transition-all"
            >
              + Add Task
            </button>
            {lead && (
              <button onClick={handleSpawnNow} disabled={pending}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-cyan-700/40 hover:bg-cyan-600/50 border border-cyan-500/30 text-cyan-200 disabled:opacity-40 transition-all">
                {pending ? "…" : "⟳ Spawn Now"}
              </button>
            )}
          </div>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAY_NAMES_SHORT.map((n) => (
            <div key={n} className="text-center text-[10px] text-white/30 py-1 font-medium">{n}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-px bg-white/[0.04] rounded-xl overflow-hidden">
          {cells.map((day, idx) => {
            if (day === null) {
              return <div key={`e-${idx}`} className="bg-[#07111e] min-h-[80px]" />;
            }
            const dateStr = `${displayYear}-${String(displayMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const isToday = dateStr === todayStr;
            const isPast = dateStr < todayStr;
            const isSelected = selectedDay === dateStr;
            const dayTasks = taskMap.get(dateStr) || [];
            const daySpawns = spawnMap.get(dateStr) || [];

            return (
              <div
                key={dateStr}
                onClick={() => handleDayClick(dateStr)}
                className={`bg-[#07111e] min-h-[80px] p-1.5 flex flex-col cursor-pointer transition-colors ${
                  isSelected ? "bg-cyan-950/60 ring-1 ring-inset ring-cyan-500/50" :
                  isToday ? "ring-1 ring-inset ring-cyan-500/30" : ""
                } ${isPast && !isSelected ? "opacity-50" : ""} hover:bg-[#0a1830]`}
              >
                {/* Day number + task count */}
                <div className="flex items-start justify-between gap-1">
                  <span className={`text-xs font-semibold leading-none ${isToday ? "text-cyan-300" : "text-white/60"}`}>
                    {day}
                  </span>
                  {dayTasks.length > 0 && (
                    <span className="text-[9px] leading-none px-1 py-0.5 rounded bg-white/10 text-white/50 font-medium">
                      {dayTasks.length}
                    </span>
                  )}
                </div>

                {/* Task priority dots */}
                {dayTasks.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 mt-1">
                    {dayTasks.slice(0, 5).map((t) => (
                      <span key={t.id} className={`h-1.5 w-1.5 rounded-full ${priorityDot(t.priority)}`} title={t.title} />
                    ))}
                  </div>
                )}

                {/* Task title previews */}
                <div className="mt-0.5 space-y-px flex-1">
                  {dayTasks.slice(0, 2).map((t) => (
                    <div key={t.id} className="text-[9px] text-white/45 leading-tight truncate">{t.title}</div>
                  ))}
                  {dayTasks.length > 2 && (
                    <div className="text-[9px] text-white/25">+{dayTasks.length - 2}</div>
                  )}
                </div>

                {/* Spawn squares (recurring) at bottom */}
                {daySpawns.length > 0 && (
                  <div className="mt-auto pt-1 border-t border-white/[0.05] flex flex-wrap gap-0.5">
                    {daySpawns.slice(0, 4).map((d) => (
                      <span key={d.id} className={`h-1.5 w-1.5 rounded-sm ${defDot(String(d.category))}`} title={`↻ ${d.title}`} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Selected day detail panel */}
        {selectedDay && (
          <div className="mt-4 rounded-xl bg-white/[0.03] border border-white/[0.07] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
              <div>
                <span className="text-sm font-semibold text-white/90">{formatDayHeading(selectedDay)}</span>
                {selectedDay < todayStr && (
                  <span className="ml-2 text-[10px] text-red-400/70">past</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleAddTask(selectedDay)}
                  disabled={pending}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-cyan-700/40 hover:bg-cyan-600/50 border border-cyan-500/30 text-cyan-200 disabled:opacity-40 transition-all"
                >
                  + Add Task for this day
                </button>
                <button onClick={() => setSelectedDay(null)} className="text-white/30 hover:text-white/60 text-sm px-1">×</button>
              </div>
            </div>

            <div className="p-4 space-y-3">
              {/* Task cards */}
              {selectedDayTasks.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-white/30 mb-2">Your Tasks</p>
                  <div className="space-y-2">
                    {selectedDayTasks.map((item) => (
                      <CalTaskCard key={item.id} item={item} today={todayStr} onOpen={setTaskRoomId} />
                    ))}
                  </div>
                </div>
              )}

              {/* Recurring spawns for this day */}
              {selectedDaySpawns.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-white/30 mb-2">Recurring Spawns</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedDaySpawns.map((def) => (
                      <span key={def.id} className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/10 text-white/60 ring-1 ${defRingColor(String(def.category))}`}>
                        <span className={`h-1.5 w-1.5 rounded-sm ${defDot(String(def.category))}`} />
                        {def.title}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selectedDayTasks.length === 0 && selectedDaySpawns.length === 0 && (
                <div className="py-6 text-center">
                  <p className="text-sm text-white/30">Nothing scheduled for this day.</p>
                  <button
                    onClick={() => handleAddTask(selectedDay)}
                    className="mt-2 text-xs text-cyan-400 hover:text-cyan-300 underline"
                  >
                    Add a task
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex gap-4 mt-3 flex-wrap items-center">
          <span className="text-[10px] text-white/25 uppercase tracking-wider">Legend</span>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-red-400" />
            <span className="text-[10px] text-white/35">P1 task</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            <span className="text-[10px] text-white/35">P2 task</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-[10px] text-white/35">P3 task</span>
          </div>
          <span className="text-white/15 select-none">|</span>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-blue-400" />
            <span className="text-[10px] text-white/35">Dev spawn</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-purple-400" />
            <span className="text-[10px] text-white/35">Music spawn</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-amber-400" />
            <span className="text-[10px] text-white/35">Marketing spawn</span>
          </div>
        </div>
      </div>

      {/* ── Upcoming (next 14 days) ──────────────────────────────────────── */}
      {(() => {
        const taskUpcoming = Array.from(taskMap.entries())
          .filter(([d]) => d >= todayStr)
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(0, 10);
        const spawnUpcoming = Array.from(upcomingSpawnMap.entries()).sort(([a], [b]) => a.localeCompare(b));
        if (taskUpcoming.length === 0 && spawnUpcoming.length === 0) return null;

        const mergedDates = [
          ...new Set([...taskUpcoming.map(([d]) => d), ...spawnUpcoming.map(([d]) => d)]),
        ].sort();

        return (
          <div className="rounded-2xl bg-white/[0.04] backdrop-blur-xl border border-white/10 p-4 md:p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="h-2 w-2 rounded-full bg-cyan-400" />
              <span className="text-sm font-semibold text-white/80">Upcoming — next 14 days</span>
            </div>
            <div className="space-y-3">
              {mergedDates.map((date) => {
                const dayTasks = taskMap.get(date) || [];
                const daySpawns = upcomingSpawnMap.get(date) || [];
                const d = new Date(date + "T00:00:00Z");
                const label = date === todayStr
                  ? "Today"
                  : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
                return (
                  <div key={date}>
                    <p className={`text-xs font-medium mb-1.5 ${date === todayStr ? "text-cyan-300" : "text-white/50"}`}>
                      {label}
                    </p>
                    <div className="space-y-1.5 pl-3 border-l border-white/[0.06]">
                      {dayTasks.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTaskRoomId(t.id)}
                          className="w-full flex items-center gap-2 hover:bg-white/[0.04] rounded-lg px-1 py-0.5 -mx-1 transition-colors"
                        >
                          <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${priorityDot(t.priority)}`} />
                          <span className="text-xs text-white/70 truncate text-left">{t.title}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ml-auto flex-shrink-0 ${statusStyle(t.status)}`}>{t.status}</span>
                        </button>
                      ))}
                      {daySpawns.map((def) => (
                        <div key={def.id} className="flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 rounded-sm flex-shrink-0 ${defDot(String(def.category))}`} />
                          <span className="text-xs text-white/40 truncate">↻ {def.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Recurring Definitions ────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white/[0.04] backdrop-blur-xl border border-white/10 p-4 md:p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-cyan-400" />
            <span className="text-sm font-semibold text-white/80">Recurring Tasks</span>
            <span className="text-xs text-white/40">
              ({initialDefs.filter((d) => d.active).length} active)
            </span>
          </div>
          {lead && (
            <button onClick={() => setDefForm(emptyDefForm())} disabled={pending}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-cyan-700/40 hover:bg-cyan-600/50 border border-cyan-500/30 text-cyan-200 disabled:opacity-40 transition-all">
              + New Recurring
            </button>
          )}
        </div>

        {initialDefs.length === 0 ? (
          <div className="py-12 text-center text-white/30 text-sm">
            No recurring tasks defined.
            {lead && (
              <div className="mt-2">
                <button onClick={() => setDefForm(emptyDefForm())} className="text-cyan-400 hover:text-cyan-300 underline text-xs">
                  Create the first one
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {initialDefs.map((def) => (
              <div key={def.id}
                className={`flex items-start gap-3 rounded-xl border px-4 py-3 transition-all ${
                  def.active ? "bg-white/[0.03] border-white/[0.08]" : "bg-white/[0.01] border-white/[0.04] opacity-50"
                }`}>
                <span className={`mt-1 h-2.5 w-2.5 rounded-full flex-shrink-0 ${defDot(String(def.category))}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white/90">{def.title}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50">{String(def.category)}</span>
                    <span className="text-[10px] text-white/35">{def.priority}</span>
                    {!def.active && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400/70 border border-red-500/20">paused</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <span className="text-xs text-white/40">{recurrenceDescription(def)}</span>
                    <span className="text-xs text-white/30">Next: <span className="text-white/50">{def.nextRun}</span></span>
                    {def.spawnedCount > 0 && <span className="text-xs text-white/25">Spawned {def.spawnedCount}×</span>}
                  </div>
                </div>
                {lead && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => handleToggleDef(def)} disabled={pending} title={def.active ? "Pause" : "Activate"}
                      className="p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/10 transition-all disabled:opacity-30">
                      {def.active ? "⏸" : "▶"}
                    </button>
                    <button onClick={() => setDefForm(defToForm(def))} disabled={pending}
                      className="p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/10 transition-all disabled:opacity-30 text-xs">✎</button>
                    <button onClick={() => handleDeleteDef(def)} disabled={pending}
                      className="p-1.5 rounded-lg text-white/30 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-30 text-xs">✕</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {taskForm && (
        <CreateTaskModal
          form={taskForm}
          setForm={setTaskForm}
          lead={lead}
          onClose={() => setTaskForm(null)}
          onSave={handleSaveTask}
          pending={pending}
        />
      )}
      {defForm && (
        <DefFormModal
          form={defForm}
          setForm={setDefForm}
          onClose={() => setDefForm(null)}
          onSave={handleSaveDef}
          pending={pending}
        />
      )}

      {taskRoomId && (() => {
        const item = myTasks.find((x) => x.id === taskRoomId);
        return item ? (
          <TaskRoom item={item} currentUser={currentUser} onClose={() => setTaskRoomId(null)} />
        ) : null;
      })()}
    </div>
  );
}
