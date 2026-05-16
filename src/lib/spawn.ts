import { revalidatePath } from "next/cache";
import { getActions, saveActions, normalizeItem, newId } from "./data";
import { computeNextRun, type ActionItem, type ActivityEvent } from "./types";

function makeActivity(user: string, action: string, detail?: string): ActivityEvent {
  const name = user === "system" ? "System" : user.charAt(0).toUpperCase() + user.slice(1);
  return {
    id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    userId: user,
    displayName: name,
    action,
    detail,
    createdAt: new Date().toISOString(),
  };
}

export async function spawnDueTasks(actor = "system"): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const doc = await getActions();
  const defs = doc.recurringDefs || [];
  const newItems: ActionItem[] = [];

  for (const def of defs) {
    if (!def.active) continue;
    if (!def.nextRun || def.nextRun > today) continue;
    if (def.lastRun === today) continue;

    const id = newId([...doc.items, ...newItems]);
    const now = new Date().toISOString();
    const item = normalizeItem({
      id,
      title: def.title,
      createdBy: actor,
      owner: def.owner as string,
      status: "TODO",
      category: def.category as string,
      priority: def.priority,
      phase: def.phase || "Define",
      notes: def.notes || "",
      taskType: def.taskType,
      requiresApproval: def.requiresApproval,
      claimable: (def.owner as string) === "Open",
      createdAt: now,
      updatedAt: now,
      activity: [makeActivity(actor, "spawned", `from recurring: ${def.title}`)],
      recurringDefId: def.id,
    });
    newItems.push(item);

    def.lastRun = today;
    def.nextRun = computeNextRun(def, new Date());
    def.spawnedCount = (def.spawnedCount || 0) + 1;
  }

  const count = newItems.length;
  if (count > 0) {
    doc.items = [...doc.items, ...newItems];
    doc.recurringDefs = defs;
    await saveActions(doc, actor, `auto-spawned ${count} recurring task(s)`);
    revalidatePath("/");
    revalidatePath("/music");
    revalidatePath("/marketing");
    revalidatePath("/calendar");
  }
  return count;
}
