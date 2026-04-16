import { Types } from "mongoose";
import { ApiKey, ApiKeyType, IApiKey } from "./apiKey.model.js";
import { IIntegration, Integration } from "./integration.model.js";

// ─── Credential Helpers ───────────────────────────────────────────────────────

export interface OAuthFields {
  refreshToken?: string | null;
  expiresAt?: Date | null;
  tokenUrl?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
}

export async function saveCredential(
  userId: Types.ObjectId,
  integrationId: string,
  type: ApiKeyType,
  key: string,
  oauth?: OAuthFields
): Promise<IApiKey> {
  const setFields: Record<string, any> = { type, key };
  if (oauth) {
    if (oauth.refreshToken !== undefined) setFields.refreshToken = oauth.refreshToken;
    if (oauth.expiresAt !== undefined) setFields.expiresAt = oauth.expiresAt;
    if (oauth.tokenUrl !== undefined) setFields.tokenUrl = oauth.tokenUrl;
    if (oauth.clientId !== undefined) setFields.clientId = oauth.clientId;
    if (oauth.clientSecret !== undefined) setFields.clientSecret = oauth.clientSecret;
  }
  const credential = await ApiKey.findOneAndUpdate(
    { userId, integrationId },
    {
      $set: setFields,
      $unset: { hashedKey: "", apiKey: "" },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, new: true }
  );
  return credential as IApiKey;
}

export async function getCredential(
  userId: Types.ObjectId,
  integrationId: string
): Promise<IApiKey | null> {
  return ApiKey.findOne({ userId, integrationId });
}

export const saveApiKey = saveCredential;
export const getApiKey = getCredential;

// ─── Integration CRUD ─────────────────────────────────────────────────────────

export async function createIntegration(input: {
  userId: string;
  name: string;
  authType?: string;
  specLocation?: string;
  status?: string;
}): Promise<{ id: string; integrationId: string }> {
  const integrationId = input.name.trim().toLowerCase();
  const doc = await Integration.findOneAndUpdate(
    { userId: new Types.ObjectId(input.userId), integrationId },
    {
      $set: {
        name: input.name,
        authType: input.authType ?? "none",
        specLocation: input.specLocation ?? "",
        status: input.status ?? "pending",
      },
      $setOnInsert: { userId: new Types.ObjectId(input.userId), integrationId },
    },
    { upsert: true, new: true }
  );
  return { id: String(doc!._id), integrationId };
}

export async function updateIntegration(
  integrationId: string,
  userId: string,
  updates: Record<string, unknown>
): Promise<void> {
  await Integration.updateOne(
    { integrationId, userId: new Types.ObjectId(userId) },
    { $set: updates }
  );
}

export async function getIntegrationById(
  integrationId: string,
  userId: string
): Promise<IIntegration | null> {
  return Integration.findOne({ integrationId, userId: new Types.ObjectId(userId) });
}

export async function getIntegrationsForUser(userId: string): Promise<IIntegration[]> {
  return Integration.find({ userId: new Types.ObjectId(userId) });
}

// ─── API Spec Upsert (used by generate_tool_registry) ──────────────────────────

export interface SaveIntegrationInput {
  userId: Types.ObjectId;
  integrationId: string;
  name: string;
  baseUrl: string;
  securitySchemes: any[];
  endpoints: Array<{
    method: string;
    path: string;
    parameters: any[];
    security: any[];
  }>;
}

export async function saveIntegration(metadata: SaveIntegrationInput): Promise<IIntegration> {
  const integration = await Integration.findOneAndUpdate(
    { userId: metadata.userId, integrationId: metadata.integrationId },
    {
      $set: {
        name: metadata.name,
        baseUrl: metadata.baseUrl,
        securitySchemes: metadata.securitySchemes,
        endpoints: metadata.endpoints,
      },
      $setOnInsert: { userId: metadata.userId, createdAt: new Date() },
    },
    { upsert: true, new: true }
  );

  return integration as IIntegration;
}
