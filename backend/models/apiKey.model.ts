import mongoose, { Document, Model, Schema, Types } from "mongoose";

export type ApiKeyType = "apiKey" | "oauth2";

export interface IApiKey extends Document {
  userId: Types.ObjectId;
  integrationId: string;
  type: ApiKeyType;
  /** Plain API key string for apiKey type.
   *  For oauth2 type: the current access_token. */
  key: string;
  /** oauth2 only: refresh token for auto-renewal */
  refreshToken?: string;
  /** oauth2 only: when the access_token expires */
  expiresAt?: Date;
  /** oauth2 only: token endpoint URL used for refreshes */
  tokenUrl?: string;
  /** oauth2 client_credentials only: stored for auto-refresh */
  clientId?: string;
  clientSecret?: string;
  createdAt: Date;
}

const ApiKeySchema: Schema<IApiKey> = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    integrationId: { type: String, required: true, index: true },
    type: { type: String, enum: ["apiKey", "oauth2"], required: true },
    key: { type: String, required: true },
    refreshToken: { type: String, default: null },
    expiresAt: { type: Date, default: null },
    tokenUrl: { type: String, default: null },
    clientId: { type: String, default: null },
    clientSecret: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  {
    collection: "api_keys",
  }
);

ApiKeySchema.index({ userId: 1, integrationId: 1 }, { unique: true });

export const ApiKey: Model<IApiKey> =
  (mongoose.models.ApiKey as Model<IApiKey>) ||
  mongoose.model<IApiKey>("ApiKey", ApiKeySchema);
