import { backendUrl } from "@/lib/backend";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(backendUrl("/api/data-version/"), {
      cache: "no-store",
    });
    if (!res.ok) return Response.json({ data_version: 0 }, { status: 502 });
    const data = await res.json();
    return Response.json(data, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "CDN-Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ data_version: 0 }, { status: 502 });
  }
}
