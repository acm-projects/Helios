import { Types } from "mongoose";
import { saveCredential, getCredential } from "../models/integration.helpers.js";

/**
 * Store a credential (API key) scoped to both userId and integrationId.
 * Uses the ApiKey Mongoose model so the unique index on {userId, integrationId} is enforced.
 */
export async function storeApiKey(
  userId: string,
  integrationId: string,
  apiKey: string
): Promise<void> {
  await saveCredential(new Types.ObjectId(userId), integrationId, "apiKey", apiKey);
}

/**
 * Retrieve a credential for a specific user + integration.
 * Returns null if none exists.
 */
export async function getStoredApiKey(
  userId: string,
  integrationId: string
): Promise<string | null> {
  const record = await getCredential(new Types.ObjectId(userId), integrationId);
  return record ? record.key : null;
}
