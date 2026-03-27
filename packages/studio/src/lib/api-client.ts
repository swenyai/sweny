/**
 * Shared fetch helper for calling the Vite dev server's AI middleware.
 *
 * Only available during development — the middleware runs in Vite's
 * configureServer hook and doesn't exist in the production SPA build.
 */

export async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
