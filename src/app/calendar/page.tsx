import { redirect } from "next/navigation";
import { getSession, isLead } from "@/lib/auth";
import { getActions } from "@/lib/data";
import { logout } from "../actions";
import { NavBar } from "@/components/NavBar";
import { CalendarBoard } from "@/components/CalendarBoard";
import { PWAInstallButton } from "@/components/PWAInstallButton";

export const dynamic = "force-dynamic";

export default async function CalendarPage() {
  const user = await getSession();
  if (!user) redirect("/login");

  const doc = await getActions();
  const defs = doc.recurringDefs || [];
  const lead = isLead(user);

  // Tasks this user owns that have a deadline (non-DONE only — calendar is action-oriented)
  const myTasks = doc.items.filter((it) => {
    if (!it.due || it.status === "DONE") return false;
    const o = String(it.owner).toLowerCase();
    const inAssignees = Array.isArray(it.assignees) && it.assignees.includes(user);
    if (user === "zaal") return o === "zaal" || o === "both" || inAssignees;
    if (user === "iman") return o === "iman" || o === "both" || inAssignees;
    return o === user || inAssignees; // thyrev and others — no "both"
  });

  const totalActive = defs.filter((d) => d.active).length;
  const totalSpawned = defs.reduce((s, d) => s + (d.spawnedCount || 0), 0);
  const overdue = myTasks.filter((it) => it.due < new Date().toISOString().slice(0, 10)).length;

  const userLabel = user === "zaal" ? "Zaal" : user === "iman" ? "Iman" : "ThyRev";

  return (
    <main className="min-h-screen relative text-white px-4 bg-[#041225] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(6,182,212,0.12),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(14,116,144,0.08),transparent_60%)]" />
      <div className="relative max-w-7xl mx-auto py-6 space-y-4">

        <header className="flex flex-col gap-3 rounded-2xl bg-white/[0.06] backdrop-blur-xl border border-white/10 px-4 sm:px-5 py-4">
          <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight">Zao Calendar</h1>
              <p className="text-white/50 text-xs mt-0.5">Your tasks by deadline · recurring schedule · auto-spawns at 07:00 UTC</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <PWAInstallButton />
              <UserBadge name={userLabel} />
              <form action={logout}>
                <button className="text-xs rounded-lg border border-white/10 px-2.5 py-1.5 hover:bg-white/5 text-white/70">
                  Sign out
                </button>
              </form>
            </div>
          </div>
          <NavBar />
        </header>

        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="My Tasks" value={myTasks.length} />
          <Stat label="Overdue" value={overdue} tone={overdue > 0 ? "red" : "ok"} />
          <Stat label="Active Recurring" value={totalActive} />
          <Stat label="Total Spawned" value={totalSpawned} />
        </section>

        <CalendarBoard
          defs={defs}
          lead={lead}
          myTasks={myTasks}
          currentUser={user}
        />

        <footer className="pt-4 text-xs text-white/30 border-t border-white/10 flex items-center justify-between">
          <span>Auto-spawns daily at 07:00 UTC · GET /api/cron</span>
          <span>Set CRON_SECRET env var to secure the endpoint</span>
        </footer>
      </div>
    </main>
  );
}

function UserBadge({ name }: { name: string }) {
  const tone =
    name === "Zaal"
      ? "bg-blue-500/30 border-blue-400/50"
      : name === "Iman"
      ? "bg-purple-500/30 border-purple-400/50"
      : "bg-emerald-500/30 border-emerald-400/50";
  return (
    <div className={`flex items-center gap-2 rounded-full border ${tone} px-2.5 py-1`}>
      <span className="h-5 w-5 rounded-full bg-black/40 flex items-center justify-center text-xs font-bold">
        {name.charAt(0)}
      </span>
      <span className="text-xs">{name}</span>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn" | "red";
}) {
  const cls =
    tone === "red"
      ? "text-red-200 border-red-500/25"
      : tone === "warn"
      ? "text-amber-200 border-amber-500/25"
      : "text-white border-white/10";
  return (
    <div className={`rounded-2xl bg-white/[0.06] backdrop-blur-xl border ${cls} px-4 py-3`}>
      <div className="text-[10px] uppercase tracking-wider text-white/50">{label}</div>
      <div className="mt-1 text-2xl font-bold leading-none">{value}</div>
    </div>
  );
}
