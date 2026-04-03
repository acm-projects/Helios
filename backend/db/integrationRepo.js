import {
  createDocument,
  readDocument,
  updateDocument,
  getCollection
} from "./mongoClient.js";


// INTEGRATIONS
export async function createIntegration(data) {
  data.createdAt = new Date();
  data.updatedAt = new Date();
  data.expiresAt = data.expiresAt || null; // Optional expiration field
  data.lastValidatedAt = data.lastValidatedAt || null; // Optional validation timestamp
  data.keyLocation = `placeholder://pending/${data._id}`; // Temporary placeholder
  return createDocument("integrations", data);
}

export async function getIntegrationById(id) {
  return readDocument("integrations", { _id: id });
}

export async function getIntegrationsForUser(userId) {
  const col = getCollection("integrations");
  return col.find({ userId }).toArray();
}

export async function updateIntegration(id, updates) {
  updates.updatedAt = new Date();
  if (updates.expiresAt === undefined) {
    updates.expiresAt = null; // Ensure expiresAt is always defined
  }
  return updateDocument("integrations", { _id: id }, updates);
}

export async function getIntegrationsWithPreferences(preferences) {
  const col = getCollection("integrations");
  const query = preferences.filter || {}; // Dynamic filter
  const projection = preferences.fields || {}; // Fields to include/exclude
  const sort = preferences.sort || {}; // Sorting preferences
  return col.find(query).project(projection).sort(sort).toArray();
}

// Add comments explaining the flexibility of keyLocation:
// keyLocation can store either:
// 1. A vault pointer (e.g., vault://user/<userId>/<service>/oauth)
// 2. A placeholder field (e.g., "storedInBackend" or "pendingSecret") until the team decides.

// VALIDATION LOGS

export async function logValidation(integrationId, status, message) {
  return createDocument("validationLogs", {
    integrationId,
    status,
    message,
    timestamp: new Date()
  });
}

// Add comments explaining:
// - keyLocation is a temporary placeholder.
// - pendingSecret is used for temporary storage of raw secrets.
// - Final storage decision (vault or backend) is pending.


// OAUTH TOKENS
export async function saveOAuthMetadata(integrationId, data) {
  // Add comments explaining flexibility:
  // OAuth tokens can either be forwarded to a vault or temporarily stored in a placeholder field.
  return createDocument("oauthTokens", {
    integrationId,
    ...data,
    createdAt: new Date()
  });
}

export async function getOAuthMetadata(integrationId) {
  return readDocument("oauthTokens", { integrationId });
}


// PRESET TOOLS

export async function addPresetTool(userId, toolName, integrationId) {
  return createDocument("presetTools", {
    userId,
    toolName,
    integrationId,
    createdAt: new Date()
  });
}

export async function getPresetToolsForUser(userId) {
  const col = getCollection("presetTools");
  return col.find({ userId }).toArray();
}