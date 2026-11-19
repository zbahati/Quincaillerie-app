import { getDatabasePool } from "@/lib/server/db/pool";

export async function GET() {
  try {
    await getDatabasePool().query("SELECT 1");
    return Response.json(
      { status: "ok", database: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "unhealthy", database: "unavailable" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
