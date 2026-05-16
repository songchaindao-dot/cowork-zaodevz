export type ActionStatus = "TODO" | "WIP" | "BLOCKED" | "DONE";
export const STATUSES: ActionStatus[] = ["TODO", "WIP", "BLOCKED", "DONE"];

export type Priority = "P1" | "P2" | "P3";
export const PRIORITIES: Priority[] = ["P1", "P2", "P3"];

export type Phase = "Define" | "Measure" | "Analyze" | "Improve" | "Control";
export const PHASES: Phase[] = ["Define", "Measure", "Analyze", "Improve", "Control"];

export type TaskType =
  | "task"
  | "work_order"
  | "incident"
  | "approval_request"
  | "goal"
  | "maintenance";
export const TASK_TYPES: TaskType[] = [
  "task", "work_order", "incident", "approval_request", "goal", "maintenance",
];
export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  task: "Task",
  work_order: "Work Order",
  incident: "Incident",
  approval_request: "Approval Request",
  goal: "Goal",
  maintenance: "Maintenance",
};

export type ReviewStatus = "pending" | "approved" | "rejected" | "changes_requested";

export type Category =
  | "ZAO Devz"
  | "Site / Tech"
  | "Ops"
  | "Bounty"
  | "Other"
  | "WaveWarZ Zambia"
  | "Recording"
  | "Distribution"
  | "Release"
  | "Artist Onboarding"
  | "Social"
  | "Brand"
  | "Content"
  | "Campaigns";

export const CATEGORIES: Category[] = [
  "ZAO Devz", "Site / Tech", "Ops", "Bounty", "Other",
  "WaveWarZ Zambia", "Recording", "Distribution", "Release", "Artist Onboarding",
  "Social", "Brand", "Content", "Campaigns",
];

export const DEV_CATEGORIES: string[] = ["ZAO Devz", "Site / Tech", "Ops", "Bounty", "Other"];
export const MUSIC_CATEGORIES: string[] = ["WaveWarZ Zambia", "Recording", "Distribution", "Release", "Artist Onboarding"];
export const MARKETING_CATEGORIES: string[] = ["Social", "Brand", "Content", "Campaigns"];

export type Owner = "Zaal" | "Iman" | "Both" | "ThyRev" | "Open";
export const OWNERS: Owner[] = ["Zaal", "Iman", "ThyRev", "Open"];

export interface Comment {
  id: string;
  userId: string;
  displayName: string;
  content: string;
  createdAt: string;
}

export interface TaskUpdate {
  id: string;
  submittedBy: string;
  displayName: string;
  content: string;
  fromStatus?: ActionStatus;
  toStatus?: ActionStatus;
  reviewStatus: ReviewStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  createdAt: string;
}

export interface ActivityEvent {
  id: string;
  userId: string;
  displayName: string;
  action: string;
  detail?: string;
  createdAt: string;
}

export type ActionItem = {
  id: string;
  title: string;
  createdBy: string;
  owner: Owner | string;
  status: ActionStatus;
  category: Category | string;
  priority: Priority;
  important: boolean;
  urgent: boolean;
  completedAt: string;
  completedBy: string;
  phase: Phase;
  due: string;           // delivery deadline (YYYY-MM-DD)
  claimBy?: string;      // deadline for claiming open task (YYYY-MM-DD)
  assignees?: string[];  // extra tagged users beyond primary owner
  holdNote?: string;     // note explaining why task is on hold / paused
  timeTracked?: number;  // total seconds logged
  timerStartedAt?: string; // ISO — current running timer session start
  notes: string;
  createdAt: string;
  updatedAt: string;
  // Operational workspace extensions
  taskType?: TaskType;
  requiresApproval?: boolean;
  assignedTo?: string;
  claimable?: boolean;
  comments?: Comment[];
  updates?: TaskUpdate[];
  activity?: ActivityEvent[];
  recurringDefId?: string;
};

export type RecurrenceType = "daily" | "weekly" | "monthly" | "yearly";
export const RECURRENCE_TYPES: RecurrenceType[] = ["daily", "weekly", "monthly", "yearly"];
export const RECURRENCE_LABELS: Record<RecurrenceType, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};
export const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTH_NAMES_FULL = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

export interface RecurringTaskDef {
  id: string;
  title: string;
  category: Category | string;
  priority: Priority;
  owner: Owner | string;
  notes?: string;
  recurrence: RecurrenceType;
  daysOfWeek?: number[];   // weekly: 0=Sun..6=Sat
  dayOfMonth?: number;     // monthly: 1–31
  yearlyMonth?: number;    // yearly: 1–12
  yearlyDay?: number;      // yearly: 1–31
  nextRun: string;         // YYYY-MM-DD — next scheduled spawn
  lastRun?: string;        // YYYY-MM-DD — last actual spawn
  spawnedCount: number;
  phase?: Phase;
  taskType?: TaskType;
  requiresApproval?: boolean;
  createdBy: string;
  createdAt: string;
  active: boolean;
}

export type ActionDoc = {
  updatedAt: string;
  items: ActionItem[];
  recurringDefs?: RecurringTaskDef[];
};

export function ageDays(createdAt: string): number {
  const ms = Date.now() - new Date(createdAt).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function cycleDays(
  createdAt: string,
  updatedAt: string,
  status: ActionStatus,
): number | null {
  if (status !== "DONE") return null;
  const ms = new Date(updatedAt).getTime() - new Date(createdAt).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function isAging(it: ActionItem): boolean {
  if (it.status === "DONE") return false;
  return ageDays(it.createdAt) > 14;
}

export type DeadlineUrgency = "overdue" | "critical" | "soon" | "ok";

export function deadlineUrgency(due: string): DeadlineUrgency | null {
  if (!due) return null;
  const d = new Date(`${due}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return null;
  const hours = (d.getTime() - Date.now()) / (1000 * 60 * 60);
  if (hours < 0) return "overdue";
  if (hours < 24) return "critical";
  if (hours < 72) return "soon";
  return "ok";
}

export function formatTrackedTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Compute the next run date strictly after `after` (defaults to now).
// Call with new Date(Date.now() - 86400000) to include today as first possible run.
export function computeNextRun(def: RecurringTaskDef, after?: Date): string {
  const base = after ? new Date(after.getTime()) : new Date();
  base.setUTCHours(0, 0, 0, 0);

  switch (def.recurrence) {
    case "daily": {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    }
    case "weekly": {
      const days = def.daysOfWeek?.length ? def.daysOfWeek : [1];
      const d = new Date(base);
      for (let i = 1; i <= 7; i++) {
        d.setUTCDate(d.getUTCDate() + 1);
        if (days.includes(d.getUTCDay())) break;
      }
      return d.toISOString().slice(0, 10);
    }
    case "monthly": {
      const dom = def.dayOfMonth || 1;
      const thisMonth = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), dom));
      if (thisMonth > base) return thisMonth.toISOString().slice(0, 10);
      const nm = base.getUTCMonth() + 1;
      const ny = base.getUTCFullYear() + (nm > 11 ? 1 : 0);
      const daysInNext = new Date(Date.UTC(ny, nm % 12 + 1, 0)).getUTCDate();
      return new Date(Date.UTC(ny, nm % 12, Math.min(dom, daysInNext))).toISOString().slice(0, 10);
    }
    case "yearly": {
      const m = (def.yearlyMonth || 1) - 1;
      const d2 = def.yearlyDay || 1;
      const thisYear = new Date(Date.UTC(base.getUTCFullYear(), m, d2));
      if (thisYear > base) return thisYear.toISOString().slice(0, 10);
      return new Date(Date.UTC(base.getUTCFullYear() + 1, m, d2)).toISOString().slice(0, 10);
    }
  }
}

function doesDefSpawnOn(def: RecurringTaskDef, date: Date): boolean {
  switch (def.recurrence) {
    case "daily": return true;
    case "weekly": return (def.daysOfWeek?.length ? def.daysOfWeek : [1]).includes(date.getUTCDay());
    case "monthly": return date.getUTCDate() === (def.dayOfMonth || 1);
    case "yearly":
      return date.getUTCMonth() + 1 === (def.yearlyMonth || 1) &&
             date.getUTCDate() === (def.yearlyDay || 1);
  }
}

export function getSpawnsInRange(
  defs: RecurringTaskDef[],
  start: Date,
  end: Date,
): Map<string, RecurringTaskDef[]> {
  const result = new Map<string, RecurringTaskDef[]>();
  const active = defs.filter((d) => d.active);
  const cur = new Date(start);
  cur.setUTCHours(0, 0, 0, 0);
  while (cur.getTime() <= end.getTime()) {
    const key = cur.toISOString().slice(0, 10);
    const hits = active.filter((d) => doesDefSpawnOn(d, cur));
    if (hits.length) result.set(key, hits);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return result;
}

export function recurrenceDescription(def: RecurringTaskDef): string {
  switch (def.recurrence) {
    case "daily": return "Every day";
    case "weekly": {
      const names = (def.daysOfWeek?.length ? def.daysOfWeek : [1])
        .sort((a, b) => a - b)
        .map((d) => DAY_NAMES_SHORT[d])
        .join(", ");
      return `Weekly — ${names}`;
    }
    case "monthly": return `Monthly — day ${def.dayOfMonth || 1}`;
    case "yearly":
      return `Yearly — ${MONTH_NAMES_FULL[(def.yearlyMonth || 1) - 1]} ${def.yearlyDay || 1}`;
  }
}
