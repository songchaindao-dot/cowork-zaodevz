import { type NextRequest, NextResponse } from "next/server";
import { spawnDueTasks } from "@/lib/spawn";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  try {
    const spawned = await spawnDueTasks("system");
    return NextResponse.json({ ok: true, spawned });
  } catch (err) {
    console.error("cron spawn error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
