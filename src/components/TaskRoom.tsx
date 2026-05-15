"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type {
  ActionItem,
  ActionStatus,
  Comment,
  TaskUpdate,
  ActivityEvent,
  Priority,
  TaskType,
} from "@/lib/types";
import {
  STATUSES,
  PRIORITIES,
  PHASES,
  OWNERS,
  CATEGORIES,
  TASK_TYPES,
  TASK_TYPE_LABELS,
  relativeTime,
  deadlineUrgency,
  formatTrackedTime,
} from "@/lib/types";
import { updateItem, addComment, submitUpdate, reviewUpdate, deleteItem, toggleTimer } from "@/app/actions";

const ALL_ASSIGNEES = ["Zaal", "Iman", "ThyRev"];

const STATUS_LABEL: Record<ActionStatus, string> = {
  TODO: "TO DO",
  WIP: "IN PROGRESS",
  BLOCKED: "BLOCKED",
  DONE: "DONE",
};

const STATUS_BADGE: Record<ActionStatus, string> = {
  TODO: "bg-slate-500/20 text-slate-200 border-slate-500/40",
  WIP: "bg-amber-500/20 text-amber-200 border-amber-500/40",
  BLOCKED: "bg-red-500/20 text-red-200 border-red-500/40",
  DONE: "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
};

const PRIORITY_BADGE: Record<Priority, string> = {
  P1: "bg-red-500/15 text-red-300 border-red-500/30",
  P2: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  P3: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

const REVIEW_BADGE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  rejected: "bg-red-500/15 text-red-300 border-red-500/30",
  changes_requested: "bg-orange-500/15 text-orange-300 border-orange-500/30",
};

const DEADLINE_BADGE: Record<string, string> = {
  overdue: "border-red-500/60 bg-red-500/15 text-red-200",
  critical: "border-orange-500/60 bg-orange-500/15 text-orange-200",
  soon: "border-amber-500/60 bg-amber-500/15 text-amber-200",
  ok: "border-white/15 text-white/55",
};

function userAvatar(userId: string, displayName: string, size = "h-7 w-7 text-xs") {
  const color =
    userId === "zaal"
      ? "bg-blue-600/40 text-blue-200"
      : userId === "iman"
      ? "bg-purple-600/40 text-purple-200"
      : userId === "thyrev"
      ? "bg-emerald-600/40 text-emerald-200"
      : "bg-slate-600/40 text-slate-200";
  return (
    <div className={`${size} flex-shrink-0 rounded-full flex items-center justify-center font-bold ${color}`}>
      {displayName.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function TaskRoom({
  item,
  currentUser,
  onClose,
}: {
  item: ActionItem;
  currentUser: string;
  onClose: () => void;
}) {
  const [panel, setPanel] = useState<"details" | "log">("details");
  const pendingUpdates = (item.updates || []).filter((u) => u.reviewStatus === "pending");
  const urgency = deadlineUrgency(item.due);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex">
      <button
        className="hidden lg:block absolute inset-0 w-full h-full cursor-default"
        style={{ background: "rgba(0,5,15,0.8)" }}
        onClick={onClose}
        tabIndex={-1}
        aria-label="Close"
      />

      <div className="relative ml-auto w-full lg:w-[90%] xl:w-[85%] 2xl:w-[78%] bg-[#07111e] border-l border-white/10 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-start gap-3 px-4 sm:px-5 py-4 border-b border-white/10 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
              <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-medium ${STATUS_BADGE[item.status]}`}>
                {STATUS_LABEL[item.status]}
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${PRIORITY_BADGE[item.priority]}`}>
                {item.priority}
              </span>
              {urgency && item.status !== "DONE" && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${DEADLINE_BADGE[urgency]}`}>
                  {urgency === "overdue" ? "Overdue" : `Due ${item.due}`}
                </span>
              )}
              {item.taskType && item.taskType !== "task" && (
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/15 text-white/55">
                  {TASK_TYPE_LABELS[item.taskType]}
                </span>
              )}
              {item.requiresApproval && (
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300">
                  Approval Required
                </span>
              )}
              {pendingUpdates.length > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 font-medium">
                  {pendingUpdates.length} awaiting review
                </span>
              )}
              {item.status === "BLOCKED" && item.holdNote && (
                <span className="text-[10px] px-2 py-0.5 rounded-full border border-red-500/30 bg-red-500/10 text-red-300">
                  On Hold
                </span>
              )}
            </div>
            <h2 className="text-sm font-semibold leading-snug">{item.title}</h2>
            <p className="mt-0.5 text-[11px] text-white/35">
              #{item.id} · {item.category}
              {item.createdBy ? ` · created by ${item.createdBy}` : ""}
              {" · "}
              {relativeTime(item.createdAt)}
              {item.timeTracked ? ` · ⏱ ${formatTrackedTime(item.timeTracked)}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 text-white/40 hover:text-white text-2xl leading-none p-2 -mr-2 rounded-lg hover:bg-white/[0.06] transition active:scale-95"
            aria-label="Close task room"
          >
            ×
          </button>
        </header>

        {/* Mobile tab bar */}
        <div className="flex lg:hidden border-b border-white/10 flex-shrink-0">
          <button
            onClick={() => setPanel("details")}
            className={`flex-1 py-2.5 text-xs font-medium transition ${panel === "details" ? "text-white border-b-2 border-blue-400" : "text-white/45"}`}
          >
            Details
          </button>
          <button
            onClick={() => setPanel("log")}
            className={`flex-1 py-2.5 text-xs font-medium transition relative ${panel === "log" ? "text-white border-b-2 border-blue-400" : "text-white/45"}`}
          >
            Activity
            {pendingUpdates.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center h-4 w-4 rounded-full bg-amber-500 text-black text-[9px] font-bold">
                {pendingUpdates.length}
              </span>
            )}
          </button>
        </div>

        {/* Two-column content */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className={`${panel === "details" ? "flex" : "hidden"} lg:flex flex-col w-full lg:w-[42%] xl:w-[40%] border-r border-white/10 overflow-y-auto`}>
            <DetailsPanel item={item} currentUser={currentUser} onClose={onClose} />
          </div>
          <div className={`${panel === "log" ? "flex" : "hidden"} lg:flex flex-col flex-1 overflow-y-auto bg-[#050e1a]`}>
            <LogPanel item={item} currentUser={currentUser} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailsPanel({
  item,
  currentUser,
  onClose,
}: {
  item: ActionItem;
  currentUser: string;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<"saved" | null>(null);
  const [watchedStatus, setWatchedStatus] = useState<ActionStatus>(item.status);

  function handleSave(fd: FormData) {
    fd.set("id", item.id);
    start(async () => {
      await updateItem(fd);
      setFlash("saved");
      setTimeout(() => setFlash(null), 2500);
    });
  }

  return (
    <div className="p-4 sm:p-5 space-y-5 flex-1">
      <form action={handleSave} className="space-y-4">
        <input type="hidden" name="_hasRequiresApproval" value="1" />

        <div>
          <label className="block text-[11px] text-white/45 mb-1 uppercase tracking-wider">Title</label>
          <input
            name="title"
            defaultValue={item.title}
            required
            className="w-full rounded-lg bg-[#0b1220] border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50 transition"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Status">
            <select
              name="status"
              defaultValue={item.status}
              onChange={(e) => setWatchedStatus(e.target.value as ActionStatus)}
              className={selectCls}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Priority">
            <select name="priority" defaultValue={item.priority} className={selectCls}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Owner">
            <select name="owner" defaultValue={String(item.owner)} className={selectCls}>
              {OWNERS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </FormField>

          <FormField label="DMAIC Phase">
            <select name="phase" defaultValue={item.phase} className={selectCls}>
              {PHASES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Category">
            <select name="category" defaultValue={String(item.category)} className={selectCls}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Task Type">
            <select name="taskType" defaultValue={item.taskType || "task"} className={selectCls}>
              {TASK_TYPES.map((t) => (
                <option key={t} value={t}>{TASK_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </FormField>

          <FormField label="Delivery Deadline">
            <input
              name="due"
              type="date"
              defaultValue={item.due}
              className={`w-full rounded-lg bg-[#0b1220] border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50 transition ${item.due && deadlineUrgency(item.due) === "overdue" ? "border-red-500/40" : item.due && deadlineUrgency(item.due) === "critical" ? "border-orange-500/40" : ""}`}
            />
          </FormField>

          <FormField label="Claim By (open tasks)">
            <input
              name="claimBy"
              type="date"
              defaultValue={item.claimBy || ""}
              className="w-full rounded-lg bg-[#0b1220] border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50 transition"
            />
          </FormField>

          <div className="col-span-2 flex flex-col gap-2 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="important" defaultChecked={item.important} className="h-4 w-4 rounded" />
              <span className="text-sm text-white/75">Important</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" name="urgent" defaultChecked={item.urgent} className="h-4 w-4 rounded" />
              <span className="text-sm text-white/75">Urgent</span>
            </label>
          </div>
        </div>

        {/* Multi-user tagging */}
        <div>
          <label className="block text-[11px] text-white/45 mb-2 uppercase tracking-wider">
            Tag Users (additional assignees)
          </label>
          <div className="flex gap-3 flex-wrap">
            {ALL_ASSIGNEES.map((u) => {
              const checked = (item.assignees || []).includes(u);
              const color = u === "Zaal" ? "blue" : u === "Iman" ? "purple" : "emerald";
              return (
                <label key={u} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    name="assignees"
                    value={u}
                    defaultChecked={checked}
                    className="h-4 w-4 rounded"
                  />
                  <span className={`text-sm text-${color}-300`}>{u}</span>
                </label>
              );
            })}
          </div>
        </div>

        <FormField label="Notes">
          <textarea
            name="notes"
            defaultValue={item.notes}
            rows={4}
            className="w-full rounded-lg bg-[#0b1220] border border-white/10 px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-blue-500/50 transition"
          />
        </FormField>

        {/* Hold note — editable when blocked */}
        {(watchedStatus === "BLOCKED" || item.status === "BLOCKED" || item.holdNote) && (
          <FormField label="Hold / Pause Note (reason this task is blocked)">
            <textarea
              name="holdNote"
              defaultValue={item.holdNote || ""}
              rows={2}
              placeholder="Why is this blocked? What's needed to unblock it?"
              className="w-full rounded-lg bg-[#0b1220] border border-red-500/20 px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-red-500/40 transition placeholder-white/25"
            />
          </FormField>
        )}

        <div className="flex items-center justify-between gap-3 rounded-xl bg-black/25 border border-white/10 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-white/90">Require Approval</p>
            <p className="text-[11px] text-white/45 mt-0.5">Worker updates go to review queue</p>
          </div>
          <input
            type="checkbox"
            name="requiresApproval"
            defaultChecked={item.requiresApproval}
            className="h-5 w-5 rounded flex-shrink-0"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-2.5 text-sm font-medium transition disabled:opacity-50"
        >
          {pending ? "Saving..." : flash === "saved" ? "Saved!" : "Save Changes"}
        </button>
      </form>

      <div className="border-t border-white/10 pt-4 space-y-2">
        <div className="text-[11px] text-white/35 space-y-1">
          <div>Created {relativeTime(item.createdAt)}{item.createdBy ? ` by ${item.createdBy}` : ""}</div>
          {item.updatedAt && item.updatedAt !== item.createdAt && (
            <div>Last updated {relativeTime(item.updatedAt)}</div>
          )}
          {item.completedAt && (
            <div>Completed {relativeTime(item.completedAt)}{item.completedBy ? ` by ${item.completedBy}` : ""}</div>
          )}
          {item.timeTracked ? (
            <div>Time tracked: {formatTrackedTime(item.timeTracked)}</div>
          ) : null}
        </div>
        <DeleteSection id={item.id} onDone={onClose} />
      </div>
    </div>
  );
}

function DeleteSection({ id, onDone }: { id: string; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);

  if (!confirm) {
    return (
      <button type="button" onClick={() => setConfirm(true)} className="text-xs text-red-400/70 hover:text-red-300 transition">
        Delete task
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-red-300">Delete this task?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          const fd = new FormData();
          fd.set("id", id);
          start(() => deleteItem(fd));
          onDone();
        }}
        className="rounded border border-red-500/40 text-red-300 hover:bg-red-500/15 px-2 py-1 transition disabled:opacity-50"
      >
        Yes, delete
      </button>
      <button type="button" onClick={() => setConfirm(false)} className="text-white/40 hover:text-white/70 transition">
        cancel
      </button>
    </div>
  );
}

function LogPanel({ item, currentUser }: { item: ActionItem; currentUser: string }) {
  const comments = item.comments || [];
  const updates = item.updates || [];
  const activity = item.activity || [];
  const pendingUpdates = updates.filter((u) => u.reviewStatus === "pending");

  type TimelineEntry =
    | { type: "activity"; data: ActivityEvent }
    | { type: "comment"; data: Comment }
    | { type: "update"; data: TaskUpdate };

  const timeline: TimelineEntry[] = [
    ...activity.map((a) => ({ type: "activity" as const, data: a })),
    ...comments.map((c) => ({ type: "comment" as const, data: c })),
    ...updates.map((u) => ({ type: "update" as const, data: u })),
  ].sort((a, b) => new Date(a.data.createdAt).getTime() - new Date(b.data.createdAt).getTime());

  return (
    <div className="p-4 sm:p-5 space-y-7">
      <TimerWidget item={item} currentUser={currentUser} />
      <SubmitUpdateBox item={item} currentUser={currentUser} />
      {pendingUpdates.length > 0 && <ReviewQueue item={item} pendingUpdates={pendingUpdates} />}

      <section>
        <h3 className="text-[10px] uppercase tracking-widest text-white/35 mb-3 font-semibold">
          Activity Timeline
        </h3>
        <div className="space-y-4 relative before:absolute before:left-3.5 before:top-1 before:bottom-1 before:w-px before:bg-white/[0.06]">
          <TimelineDot icon="+" text={`Task created${item.createdBy ? ` by ${item.createdBy}` : ""}`} time={item.createdAt} />
          {timeline.map((entry) => {
            if (entry.type === "activity") {
              const a = entry.data;
              return <TimelineDot key={a.id} icon={activityIcon(a.action)} text={formatActivity(a)} time={a.createdAt} />;
            }
            if (entry.type === "comment") {
              const c = entry.data;
              return (
                <div key={c.id} className="flex gap-3 pl-1">
                  {userAvatar(c.userId, c.displayName)}
                  <div className="flex-1 min-w-0 bg-black/25 rounded-xl border border-white/10 px-3 py-2.5">
                    <div className="text-[11px] text-white/45 mb-1">
                      <span className="text-white/80 font-medium">{c.displayName}</span>{" · "}{relativeTime(c.createdAt)}
                    </div>
                    <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{c.content}</p>
                  </div>
                </div>
              );
            }
            if (entry.type === "update") {
              return <UpdateCard key={entry.data.id} update={entry.data} />;
            }
            return null;
          })}
          {timeline.length === 0 && (
            <p className="pl-7 text-xs text-white/30 italic">No activity yet. Submit an update or leave a comment.</p>
          )}
        </div>
      </section>

      <CommentsBox item={item} currentUser={currentUser} />
    </div>
  );
}

function TimerWidget({ item, currentUser }: { item: ActionItem; currentUser: string }) {
  const [pending, start] = useTransition();
  const [liveSeconds, setLiveSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!item.timerStartedAt) {
      setLiveSeconds(0);
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    const tick = () => {
      setLiveSeconds(Math.floor((Date.now() - new Date(item.timerStartedAt!).getTime()) / 1000));
    };
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [item.timerStartedAt]);

  const isRunning = !!item.timerStartedAt;
  const totalTracked = (item.timeTracked || 0) + (isRunning ? liveSeconds : 0);

  function handleToggle() {
    const fd = new FormData();
    fd.set("id", item.id);
    start(() => toggleTimer(fd));
  }

  return (
    <section>
      <h3 className="text-[10px] uppercase tracking-widest text-white/35 mb-3 font-semibold">Time Tracker</h3>
      <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 flex items-center gap-4">
        <div className="flex-1 min-w-0">
          {isRunning && (
            <div className="text-xs text-emerald-400 mb-1 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Running — {formatTrackedTime(liveSeconds)}
            </div>
          )}
          <div className="text-sm text-white/70">
            Total: <span className="font-semibold text-white">{formatTrackedTime(totalTracked)}</span>
          </div>
        </div>
        <button
          onClick={handleToggle}
          disabled={pending}
          className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition disabled:opacity-40 ${
            isRunning
              ? "bg-red-600/80 hover:bg-red-600 border border-red-500/40 text-white"
              : "bg-emerald-600/80 hover:bg-emerald-600 border border-emerald-500/40 text-white"
          }`}
        >
          {isRunning ? "Stop" : "Start"}
        </button>
      </div>
    </section>
  );
}

function SubmitUpdateBox({ item, currentUser }: { item: ActionItem; currentUser: string }) {
  const [pending, start] = useTransition();
  const [content, setContent] = useState("");
  const [toStatus, setToStatus] = useState<ActionStatus | "">("");

  function handleSubmit() {
    if (!content.trim()) return;
    const fd = new FormData();
    fd.set("id", item.id);
    fd.set("content", content);
    if (toStatus) fd.set("toStatus", toStatus);
    start(async () => {
      await submitUpdate(fd);
      setContent("");
      setToStatus("");
    });
  }

  return (
    <section>
      <h3 className="text-[10px] uppercase tracking-widest text-white/35 mb-3 font-semibold">Submit Progress Update</h3>
      <div className="rounded-xl border border-white/10 bg-black/25 overflow-hidden">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What progress have you made? What's done? What's blocking you? What's next?"
          rows={3}
          className="w-full bg-transparent px-4 pt-4 pb-2 text-sm text-white/80 placeholder-white/25 resize-none focus:outline-none"
        />
        <div className="flex items-center gap-2 px-4 pb-3">
          <select
            value={toStatus}
            onChange={(e) => setToStatus(e.target.value as ActionStatus | "")}
            className="flex-1 rounded-lg bg-[#0b1220] border border-white/10 px-2.5 py-1.5 text-xs text-white/80 focus:outline-none"
          >
            <option value="">Move to status (optional)</option>
            {STATUSES.filter((s) => s !== item.status).map((s) => (
              <option key={s} value={s}>→ {STATUS_LABEL[s]}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending || !content.trim()}
            className="rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-1.5 text-xs font-semibold transition disabled:opacity-40 whitespace-nowrap"
          >
            {pending ? "Submitting..." : item.requiresApproval ? "Submit for Review" : "Submit Update"}
          </button>
        </div>
        {item.requiresApproval && (
          <p className="px-4 pb-3 text-[10px] text-amber-300/60">
            Requires lead approval — status changes take effect once approved.
          </p>
        )}
      </div>
    </section>
  );
}

function ReviewQueue({ item, pendingUpdates }: { item: ActionItem; pendingUpdates: TaskUpdate[] }) {
  return (
    <section>
      <h3 className="text-[10px] uppercase tracking-widest text-amber-400/60 mb-3 font-semibold">
        Review Queue ({pendingUpdates.length})
      </h3>
      <div className="space-y-3">
        {pendingUpdates.map((u) => (
          <ReviewCard key={u.id} item={item} update={u} />
        ))}
      </div>
    </section>
  );
}

function ReviewCard({ item, update }: { item: ActionItem; update: TaskUpdate }) {
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState("");

  function decide(decision: "approved" | "rejected" | "changes_requested") {
    const fd = new FormData();
    fd.set("id", item.id);
    fd.set("updateId", update.id);
    fd.set("decision", decision);
    if (notes.trim()) fd.set("reviewNotes", notes.trim());
    start(() => reviewUpdate(fd));
  }

  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 space-y-3">
      <div className="flex items-start gap-2">
        {userAvatar(update.submittedBy, update.displayName, "h-6 w-6 text-[10px]")}
        <div className="flex-1 min-w-0">
          <span className="text-xs text-white/80 font-medium">{update.displayName}</span>
          {update.toStatus && (
            <span className="ml-1.5 text-[10px] text-white/45">requesting → {STATUS_LABEL[update.toStatus]}</span>
          )}
          <div className="text-[10px] text-white/30 mt-0.5">{relativeTime(update.createdAt)}</div>
        </div>
      </div>
      <p className="text-sm text-white/75 whitespace-pre-wrap leading-relaxed">{update.content}</p>
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Review note (optional)"
        className="w-full rounded-lg bg-[#0b1220] border border-white/10 px-3 py-2 text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/25"
      />
      <div className="flex gap-2">
        <button onClick={() => decide("approved")} disabled={pending} className="flex-1 rounded-lg bg-emerald-700/60 hover:bg-emerald-600/80 border border-emerald-500/30 px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40">
          Approve
        </button>
        <button onClick={() => decide("changes_requested")} disabled={pending} className="flex-1 rounded-lg bg-orange-700/60 hover:bg-orange-600/80 border border-orange-500/30 px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40">
          Needs Changes
        </button>
        <button onClick={() => decide("rejected")} disabled={pending} className="flex-1 rounded-lg bg-red-800/60 hover:bg-red-700/80 border border-red-500/30 px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40">
          Reject
        </button>
      </div>
    </div>
  );
}

function UpdateCard({ update }: { update: TaskUpdate }) {
  return (
    <div className="pl-1 flex gap-3">
      {userAvatar(update.submittedBy, update.displayName)}
      <div className="flex-1 min-w-0">
        <div className={`rounded-xl border p-3 ${
          update.reviewStatus === "pending" ? "border-amber-500/20 bg-amber-500/5"
          : update.reviewStatus === "approved" ? "border-emerald-500/20 bg-emerald-500/5"
          : "border-red-500/20 bg-red-500/5"
        }`}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-[11px] text-white/50">
              <span className="text-white/80 font-medium">{update.displayName}</span>
              {" submitted update"}
              {update.toStatus && <span className="ml-1 text-white/40">→ {STATUS_LABEL[update.toStatus]}</span>}
              {" · "}{relativeTime(update.createdAt)}
            </div>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium whitespace-nowrap ${REVIEW_BADGE[update.reviewStatus]}`}>
              {update.reviewStatus.replace("_", " ")}
            </span>
          </div>
          <p className="text-sm text-white/75 whitespace-pre-wrap leading-relaxed">{update.content}</p>
          {update.reviewNotes && (
            <p className="mt-2 text-[11px] text-white/40 italic border-t border-white/10 pt-2">
              Review: {update.reviewNotes}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function CommentsBox({ item, currentUser }: { item: ActionItem; currentUser: string }) {
  const [pending, start] = useTransition();
  const [content, setContent] = useState("");
  const comments = item.comments || [];

  function handleSend() {
    if (!content.trim()) return;
    const fd = new FormData();
    fd.set("id", item.id);
    fd.set("content", content);
    start(async () => {
      await addComment(fd);
      setContent("");
    });
  }

  return (
    <section>
      <h3 className="text-[10px] uppercase tracking-widest text-white/35 mb-3 font-semibold">Comments</h3>
      <div className="space-y-3 mb-4">
        {comments.length === 0 && <p className="text-xs text-white/25 italic">No comments yet.</p>}
        {comments.map((c) => (
          <div key={c.id} className="flex gap-3">
            {userAvatar(c.userId, c.displayName)}
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-white/40 mb-1">
                <span className="text-white/75 font-medium">{c.displayName}</span>{" · "}{relativeTime(c.createdAt)}
              </div>
              <p className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">{c.content}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-white/10 bg-black/25 overflow-hidden">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={`Write a comment… (Ctrl+Enter to send)`}
          rows={3}
          className="w-full bg-transparent px-4 pt-3 pb-1 text-sm text-white/80 placeholder-white/25 resize-none focus:outline-none"
        />
        <div className="flex justify-end p-2.5 pt-1">
          <button
            type="button"
            onClick={handleSend}
            disabled={pending || !content.trim()}
            className="rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-1.5 text-xs font-semibold transition disabled:opacity-40"
          >
            {pending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </section>
  );
}

function TimelineDot({ icon, text, time }: { icon: string; text: string; time: string }) {
  return (
    <div className="flex items-start gap-3 pl-1">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center text-[10px] text-white/50">
        {icon}
      </div>
      <div className="flex-1 min-w-0 pt-1">
        <span className="text-xs text-white/55 break-words">{text}</span>
        <span className="ml-2 text-[10px] text-white/25 whitespace-nowrap">{relativeTime(time)}</span>
      </div>
    </div>
  );
}

function activityIcon(action: string): string {
  if (action === "created") return "+";
  if (action === "status_changed") return "↔";
  if (action === "commented") return "·";
  if (action === "update_submitted") return "↑";
  if (action === "review_approved") return "✓";
  if (action === "review_rejected") return "✕";
  if (action === "review_changes_requested") return "~";
  if (action === "timer_started") return "▶";
  if (action === "timer_stopped") return "■";
  if (action === "claimed") return "⚑";
  return "·";
}

function formatActivity(a: ActivityEvent): string {
  const dn = a.displayName;
  if (a.action === "status_changed") return `${dn} changed status${a.detail ? ` (${a.detail})` : ""}`;
  if (a.action === "commented") return `${dn} commented`;
  if (a.action === "update_submitted") return `${dn} ${a.detail || "submitted an update"}`;
  if (a.action === "review_approved") return `${dn} approved the update`;
  if (a.action === "review_rejected") return `${dn} rejected the update`;
  if (a.action === "review_changes_requested") return `${dn} requested changes`;
  if (a.action === "created") return `Task created by ${dn}`;
  if (a.action === "timer_started") return `${dn} started time tracker`;
  if (a.action === "timer_stopped") return `${dn} stopped timer${a.detail ? ` — ${a.detail}` : ""}`;
  if (a.action === "claimed") return `${dn} claimed this task`;
  return `${dn}: ${a.detail || a.action}`;
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] text-white/45 mb-1 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}

const selectCls =
  "w-full rounded-lg bg-[#0b1220] border border-white/10 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500/50 transition";
