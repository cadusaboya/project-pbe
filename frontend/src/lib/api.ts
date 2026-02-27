import { backendUrl } from "./backend";
import { DEFAULT_GAME_VERSION } from "./constants";

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

/**
 * Convenience wrapper: fetchApi + JSON parse.
 * Returns the parsed response body typed as T.
 */
export async function fetchJson<T>(
  path: string,
  opts: { revalidate?: number } = {},
  dv?: number,
): Promise<T> {
  const res = await fetchApi(path, opts, dv);
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

/**
 * Fetch the list of available game versions for a server.
 * Returns versions sorted descending (latest first).
 */
export async function fetchVersions(server: string): Promise<string[]> {
  try {
    return await fetchJson<string[]>(`/api/versions/?server=${server}`);
  } catch {
    return [];
  }
}

/**
 * Get the default game version for a server.
 * Returns the latest available version from the API.
 * Falls back to DEFAULT_GAME_VERSION for PBE, or empty string for LIVE.
 */
export async function getDefaultVersion(server: string): Promise<string> {
  const versions = await fetchVersions(server);
  if (versions.length > 0) return versions[0];
  return server === "PBE" ? DEFAULT_GAME_VERSION : "";
}
