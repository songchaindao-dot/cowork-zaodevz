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
};

export type ActionDoc = {
  updatedAt: string;
  items: ActionItem[];
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
