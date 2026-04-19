// Mints a GitHub Actions OIDC token so the CLI can authenticate to SWEny Cloud
// without a long-lived shared secret.
//
// GitHub injects two env vars into any step that has `permissions: id-token: write`:
//   • ACTIONS_ID_TOKEN_REQUEST_URL   — the mint endpoint on the runner
//   • ACTIONS_ID_TOKEN_REQUEST_TOKEN — short-lived bearer to call that endpoint
//
// Reference:
// https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect

/**
 * Returns true iff the current process is running inside a GitHub Actions step
 * with `id-token: write` permissions. When false, callers should fall back to
 * another auth method.
 */
export function hasGitHubOidc(): boolean {
  return Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
}

export interface OidcMintOptions {
  /**
   * The `aud` claim to bake into the JWT. Must match what the verifier expects
   * (SWEny Cloud: the public site URL, e.g. `https://cloud.sweny.ai`).
   */
  audience: string;
  /** Abort the fetch after this many ms. Default 5000. */
  timeoutMs?: number;
}

/**
 * Request a new OIDC token from the runner. Throws if the env vars aren't
 * present or the runner refuses. Callers should catch and fall back rather
 * than block the workflow.
 */
export async function mintGitHubOidcToken(opts: OidcMintOptions): Promise<string> {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) {
    throw new Error("GitHub OIDC env vars missing. The workflow step must declare `permissions: { id-token: write }`.");
  }

  const mintUrl = new URL(url);
  mintUrl.searchParams.set("audience", opts.audience);

  const res = await fetch(mintUrl.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${bearer}`,
      Accept: "application/json; api-version=2.0",
      "User-Agent": "sweny-cli",
    },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
  });

  if (!res.ok) {
    throw new Error(`OIDC mint failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { value?: string };
  if (!data.value || typeof data.value !== "string") {
    throw new Error("OIDC mint response missing `value`");
  }
  return data.value;
}
