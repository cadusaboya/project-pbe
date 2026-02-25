import { backendUrl } from "./backend";

/**
 * Fetch the current data version (match count) from the backend.
 * Cached by Next.js ISR for 30 seconds — within any 30s window,
 * all server components see the same data version.
 */
export async function getDataVersion(): Promise<number> {
  try {
    const res = await fetch(backendUrl("/api/data-version/"), {
      next: { revalidate: 30 },
    });
    if (!res.ok) return 0;
    const data = await res.json();
    return data.data_version ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Fetch a backend API path with data-version cache busting.
 * Appends `_v={dataVersion}` so ISR cache keys change when data changes.
 */
export async function fetchApi(
  path: string,
  opts: { revalidate?: number } = {},
  dv?: number,
): Promise<Response> {
  const dataVersion = dv ?? (await getDataVersion());
  const separator = path.includes("?") ? "&" : "?";
  return fetch(backendUrl(`${path}${separator}_v=${dataVersion}`), {
    next: { revalidate: opts.revalidate ?? 300 },
  });
}
