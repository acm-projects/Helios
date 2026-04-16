import { Types } from "mongoose";
import { saveCredential, getCredential } from "../models/integration.helpers.js";
import { ApiKey } from "../models/apiKey.model.js";

// ─── Simple API key ──────────────────────────────────────────────────────────

export async function storeApiKey(
  userId: string,
  integrationId: string,
  apiKey: string
): Promise<void> {
  await saveCredential(new Types.ObjectId(userId), integrationId, "apiKey", apiKey);
}

// ─── OAuth2 — Client Credentials ─────────────────────────────────────────────
// Fetches a fresh access_token and stores it along with the credentials needed
// to refresh it in the future (clientId + clientSecret + tokenUrl).

export async function storeOAuthClientCredentials(
  userId: string,
  integrationId: string,
  clientId: string,
  clientSecret: string,
  tokenUrl: string
): Promise<{ expiresIn: number | null }> {
  const { accessToken, expiresIn } = await fetchClientCredentialsToken(clientId, clientSecret, tokenUrl);

  const expiresAt = expiresIn != null
    ? new Date(Date.now() + expiresIn * 1000 - 60_000) // 60s buffer
    : null;

  await saveCredential(new Types.ObjectId(userId), integrationId, "oauth2", accessToken, {
    tokenUrl,
    clientId,
    clientSecret,
    expiresAt,
    refreshToken: null,
  });

  return { expiresIn };
}

// ─── OAuth2 — Authorization Code (refresh token) ─────────────────────────────
// The user supplies their own refresh_token (obtained from their auth flow).
// We store it and auto-exchange it for a new access_token as needed.

export async function storeOAuthRefreshToken(
  userId: string,
  integrationId: string,
  opts: {
    refreshToken: string;
    tokenUrl: string;
    clientId?: string;
    clientSecret?: string;
    accessToken?: string;
    expiresIn?: number | null;
  }
): Promise<void> {
  let accessToken = opts.accessToken ?? "";
  let expiresAt: Date | null = null;

  // If no access_token was provided, try to exchange the refresh_token immediately
  if (!accessToken && opts.clientId && opts.clientSecret) {
    try {
      const result = await fetchRefreshTokenExchange(
        opts.refreshToken, opts.tokenUrl, opts.clientId, opts.clientSecret
      );
      accessToken = result.accessToken;
      if (result.expiresIn != null) {
        expiresAt = new Date(Date.now() + result.expiresIn * 1000 - 60_000);
      }
    } catch { /* store anyway — refresh will be attempted on first use */ }
  } else if (opts.expiresIn != null) {
    expiresAt = new Date(Date.now() + opts.expiresIn * 1000 - 60_000);
  }

  await saveCredential(new Types.ObjectId(userId), integrationId, "oauth2", accessToken, {
    refreshToken: opts.refreshToken,
    tokenUrl: opts.tokenUrl,
    clientId: opts.clientId ?? null,
    clientSecret: opts.clientSecret ?? null,
    expiresAt,
  });
}

// ─── Retrieve — with auto-refresh ────────────────────────────────────────────

export async function getStoredApiKey(
  userId: string,
  integrationId: string
): Promise<string | null> {
  const record = await getCredential(new Types.ObjectId(userId), integrationId);
  if (!record) return null;

  // Plain API key — return directly
  if (record.type === "apiKey") return record.key;

  // OAuth2 — check if the access_token is still valid
  const nowWithBuffer = new Date(Date.now() + 30_000); // 30s buffer
  const isExpired = record.expiresAt != null && record.expiresAt <= nowWithBuffer;

  if (!isExpired && record.key) return record.key;

  // Token is expired (or missing) — try to refresh
  try {
    if (record.refreshToken && record.tokenUrl) {
      // Authorization Code flow: exchange refresh_token
      const { accessToken, expiresIn } = await fetchRefreshTokenExchange(
        record.refreshToken, record.tokenUrl, record.clientId ?? undefined, record.clientSecret ?? undefined
      );
      const expiresAt = expiresIn != null
        ? new Date(Date.now() + expiresIn * 1000 - 60_000)
        : null;
      await ApiKey.updateOne(
        { userId: record.userId, integrationId },
        { $set: { key: accessToken, expiresAt } }
      );
      return accessToken;
    }

    if (record.clientId && record.clientSecret && record.tokenUrl) {
      // Client Credentials flow: re-fetch token
      const { accessToken, expiresIn } = await fetchClientCredentialsToken(
        record.clientId, record.clientSecret, record.tokenUrl
      );
      const expiresAt = expiresIn != null
        ? new Date(Date.now() + expiresIn * 1000 - 60_000)
        : null;
      await ApiKey.updateOne(
        { userId: record.userId, integrationId },
        { $set: { key: accessToken, expiresAt } }
      );
      return accessToken;
    }
  } catch {
    // Refresh failed — return stale token rather than null (caller decides)
    return record.key || null;
  }

  // No refresh path available — return whatever we have
  return record.key || null;
}

// ─── Low-level token fetchers ─────────────────────────────────────────────────

async function fetchClientCredentialsToken(
  clientId: string,
  clientSecret: string,
  tokenUrl: string
): Promise<{ accessToken: string; expiresIn: number | null }> {
  validateTokenUrl(tokenUrl);
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let tokenRes: Response;
  try {
    tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const data = await tokenRes.json() as any;
  if (!tokenRes.ok || !data.access_token) {
    const msg = data.error_description || data.error || "Token exchange failed";
    throw new Error(msg);
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? null };
}

async function fetchRefreshTokenExchange(
  refreshToken: string,
  tokenUrl: string,
  clientId?: string,
  clientSecret?: string
): Promise<{ accessToken: string; expiresIn: number | null }> {
  validateTokenUrl(tokenUrl);
  const params = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken });
  if (clientId) params.set("client_id", clientId);
  if (clientSecret) params.set("client_secret", clientSecret);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let tokenRes: Response;
  try {
    tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  const data = await tokenRes.json() as any;
  if (!tokenRes.ok || !data.access_token) {
    const msg = data.error_description || data.error || "Refresh failed";
    throw new Error(msg);
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? null };
}

function validateTokenUrl(tokenUrl: string): void {
  let parsed: URL;
  try { parsed = new URL(tokenUrl); } catch { throw new Error("tokenUrl is not a valid URL"); }
  if (parsed.protocol !== "https:") throw new Error("tokenUrl must use HTTPS");
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.)/.test(parsed.hostname)) {
    throw new Error("tokenUrl must be a public URL");
  }
}
