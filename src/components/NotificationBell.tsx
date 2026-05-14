"use client";

import { useEffect, useState } from "react";
import { relativeTime } from "@/lib/types";
import type { ActionItem } from "@/lib/types";

type NotifType =
  | "assigned"
  | "approval_needed"
  | "open_task"
  | "claimed"
  | "review_approved"
  | "review_rejected"
  | "review_changes";

interface Notification {
  id: string;
  type: NotifType;
  itemId: string;
  message: string;
  read: boolean;
  createdAt: string;
}

interface MyPendingUpdate {
  updateId: string;
  itemId: string;
  reviewStatus: string;
}

interface Snapshot {
  assignedIds: string[];
  openIds: string[];
  pendingUpdateIds: string[];
  myPendingUpdates: MyPendingUpdate[];
}

const TYPE_DOT: Record<NotifType, string> = {
  assigned: "bg-blue-400",
  approval_needed: "bg-amber-400",
  open_task: "bg-emerald-400",
  claimed: "bg-purple-400",
  review_approved: "bg-emerald-400",
  review_rejected: "bg-red-400",
  review_changes: "bg-orange-400",
};

function genId(): string {
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function NotificationBell({
  items,
  currentUser,
  isLeadUser,
  onOpenTask,
}: {
  items: ActionItem[];
  currentUser: string;
  isLeadUser: boolean;
  onOpenTask: (id: string) => void;
}) {
  const userKey = currentUser.trim().toLowerCase() || "user";
  const notifsKey = `zao-notifs-v1:${userKey}`;
  const snapKey = `zao-notif-snap-v1:${userKey}`;
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notification[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(notifsKey);
    if (raw) {
      try { setNotifs(JSON.parse(raw)); } catch {}
    }
  }, [notifsKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const snapRaw = window.localStorage.getItem(snapKey);
    let snap: Snapshot | null = null;
    if (snapRaw) {
      try { snap = JSON.parse(snapRaw); } catch {}
    }

    // ── Compute current state ──────────────────────────────────────
    const assignedIds = items
      .filter((it) => it.status !== "DONE" && String(it.owner).toLowerCase() === userKey)
      .map((it) => it.id);

    const openIds = items
      .filter((it) => it.status !== "DONE" && (it.claimable || String(it.owner).toLowerCase() === "open"))
      .map((it) => it.id);

    // Pending reviews (for leads — updates submitted by anyone)
    const pendingUpdateIds: string[] = [];
    if (isLeadUser) {
      for (const it of items) {
        for (const u of it.updates || []) {
          if (u.reviewStatus === "pending") pendingUpdateIds.push(u.id);
        }
      }
    }

    // Updates submitted by ME (to detect when leads review them)
    const myPendingUpdates: MyPendingUpdate[] = items.flatMap((it) =>
      (it.updates || [])
        .filter((u) => u.submittedBy === userKey)
        .map((u) => ({ updateId: u.id, itemId: it.id, reviewStatus: u.reviewStatus }))
    );

    // ── Persist snapshot ───────────────────────────────────────────
    window.localStorage.setItem(
      snapKey,
      JSON.stringify({ assignedIds, openIds, pendingUpdateIds, myPendingUpdates }),
    );

    if (!snap) return; // First visit — initialize only, no notifications

    const now = new Date().toISOString();
    const newNotifs: Notification[] = [];

    const prevAssigned = new Set(snap.assignedIds);
    const prevOpen = new Set(snap.openIds);
    const prevPending = new Set(snap.pendingUpdateIds);
    const curOpenSet = new Set(openIds);

    // ── Tasks newly assigned to me ─────────────────────────────────
    for (const id of assignedIds) {
      if (!prevAssigned.has(id)) {
        const it = items.find((x) => x.id === id);
        if (it) {
          newNotifs.push({
            id: genId(), type: "assigned", itemId: id,
            message: `Task assigned to you: ${it.title}`,
            read: false, createdAt: now,
          });
        }
      }
    }

    // ── New open / claimable tasks ─────────────────────────────────
    for (const id of openIds) {
      if (!prevOpen.has(id)) {
        const it = items.find((x) => x.id === id);
        if (it) {
          newNotifs.push({
            id: genId(), type: "open_task", itemId: id,
            message: `Open task available to claim: ${it.title}`,
            read: false, createdAt: now,
          });
        }
      }
    }

    // ── Tasks that were open and got claimed ───────────────────────
    for (const id of snap.openIds) {
      if (!curOpenSet.has(id)) {
        const it = items.find((x) => x.id === id);
        if (it && it.status !== "DONE" && !it.claimable && String(it.owner).toLowerCase() !== "open") {
          newNotifs.push({
            id: genId(), type: "claimed", itemId: id,
            message: `${it.owner} is working on: ${it.title}`,
            read: false, createdAt: now,
          });
        }
      }
    }

    // ── New pending reviews — LEADS ONLY ──────────────────────────
    if (isLeadUser) {
      for (const uid of pendingUpdateIds) {
        if (!prevPending.has(uid)) {
          for (const it of items) {
            const u = (it.updates || []).find((x) => x.id === uid);
            if (u) {
              const markedDone = u.toStatus === "DONE";
              newNotifs.push({
                id: genId(), type: "approval_needed", itemId: it.id,
                message: markedDone
                  ? `${u.displayName} marked as done — needs review: ${it.title}`
                  : `${u.displayName} submitted update for review: ${it.title}`,
                read: false, createdAt: now,
              });
              break;
            }
          }
        }
      }
    }

    // ── Review decisions — notify the submitter ────────────────────
    // When one of MY previously-pending updates gets approved/rejected/changes
    for (const prev of snap.myPendingUpdates || []) {
      if (prev.reviewStatus !== "pending") continue; // Already had a decision last time
      const it = items.find((x) => x.id === prev.itemId);
      if (!it) continue;
      const u = (it.updates || []).find((x) => x.id === prev.updateId);
      if (!u || u.reviewStatus === "pending") continue; // Still pending or gone

      let type: NotifType = "review_approved";
      let message = "";

      if (u.reviewStatus === "approved") {
        type = "review_approved";
        message = u.toStatus === "DONE"
          ? `Task marked complete: ${it.title}`
          : `Your update was approved: ${it.title}`;
      } else if (u.reviewStatus === "rejected") {
        type = "review_rejected";
        message = u.reviewNotes
          ? `Update rejected: ${it.title} — "${u.reviewNotes}"`
          : `Update rejected: ${it.title}`;
      } else if (u.reviewStatus === "changes_requested") {
        type = "review_changes";
        message = u.reviewNotes
          ? `Changes requested: ${it.title} — "${u.reviewNotes}"`
          : `Changes requested on: ${it.title}`;
      }

      if (message) {
        newNotifs.push({ id: genId(), type, itemId: prev.itemId, message, read: false, createdAt: now });
      }
    }

    if (newNotifs.length === 0) return;

    setNotifs((prev) => {
      const updated = [...newNotifs, ...prev].slice(0, 50);
      window.localStorage.setItem(notifsKey, JSON.stringify(updated));
      return updated;
    });
  }, [items, userKey, isLeadUser, snapKey, notifsKey]);

  const unread = notifs.filter((n) => !n.read).length;

  function handleNotifClick(n: Notification) {
    setNotifs((prev) => {
      const updated = prev.map((x) => (x.id === n.id ? { ...x, read: true } : x));
      window.localStorage.setItem(notifsKey, JSON.stringify(updated));
      return updated;
    });
    setOpen(false);
    onOpenTask(n.itemId);
  }

  function markAllRead() {
    setNotifs((prev) => {
      const updated = prev.map((n) => ({ ...n, read: true }));
      window.localStorage.setItem(notifsKey, JSON.stringify(updated));
      return updated;
    });
  }

  function clearAll() {
    setNotifs([]);
    window.localStorage.removeItem(notifsKey);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative rounded-xl border border-white/10 px-3 py-2 text-sm transition ${
          open ? "bg-white/10 text-white" : "text-white/70 hover:bg-white/5"
        }`}
        aria-label="Notifications"
        title="Notifications"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-[9px] font-bold flex items-center justify-center leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-80 max-w-[calc(100vw-2rem)] max-h-[28rem] overflow-y-auto rounded-2xl bg-[#0d1f35] border border-white/10 shadow-2xl">
            <div className="sticky top-0 bg-[#0d1f35] border-b border-white/10 px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-semibold">
                Notifications
                {unread > 0 && (
                  <span className="ml-2 text-[10px] rounded-full bg-red-500/20 text-red-300 border border-red-500/30 px-1.5 py-0.5">
                    {unread} new
                  </span>
                )}
              </span>
              <div className="flex gap-3">
                {unread > 0 && (
                  <button onClick={markAllRead} className="text-[11px] text-white/50 hover:text-white/80 transition">
                    Mark read
                  </button>
                )}
                {notifs.length > 0 && (
                  <button onClick={clearAll} className="text-[11px] text-white/50 hover:text-white/80 transition">
                    Clear all
                  </button>
                )}
              </div>
            </div>

            {notifs.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <div className="text-2xl mb-2">🔔</div>
                <p className="text-sm text-white/40">No notifications yet</p>
                <p className="text-[11px] text-white/25 mt-1">
                  You&apos;ll see assignments, reviews, and task updates here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-white/5">
                {notifs.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => handleNotifClick(n)}
                      className={`w-full text-left px-4 py-3 flex items-start gap-3 transition ${
                        n.read
                          ? "opacity-50 hover:opacity-80 hover:bg-white/[0.02]"
                          : "hover:bg-white/[0.06]"
                      }`}
                    >
                      <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${TYPE_DOT[n.type]}`} />
                      <div className="flex-1 min-w-0 text-left">
                        <p className={`text-sm leading-snug ${n.read ? "text-white/60" : "text-white/90"}`}>
                          {n.message}
                        </p>
                        <p className="mt-0.5 text-[11px] text-white/35">
                          {relativeTime(n.createdAt)} · tap to open task
                        </p>
                      </div>
                      {!n.read && (
                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
