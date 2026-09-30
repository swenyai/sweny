/**
 * Shared fetch helper for calling the Vite dev server's AI middleware.
 *
 * Only available during development — the middleware runs in Vite's
 * configureServer hook and doesn't exist in the production SPA build.
 */

export async function post<T>(url: string, body: unknown): Promise<T> {
  // Bootstrap for each action so an open tab survives a dev server restart.
  const session = await fetch("/api/ai-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const sessionData = await session.json();
  if (!session.ok) {
    throw new Error(sessionData.error ?? `Server error ${session.status}`);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Sweny-Dev-Token": sessionData.token },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error ?? `Server error ${res.status}`);
  }

  return data as T;
}

/**
 * Returns true when running inside Vite dev server (AI middleware available).
 */
export function isDevServer(): boolean {
  return import.meta.env.DEV;
}
