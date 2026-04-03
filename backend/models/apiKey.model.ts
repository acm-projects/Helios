import mongoose, { Document, Model, Schema, Types } from "mongoose";

export type ApiKeyType = "apiKey" | "oauth2";

export interface IApiKey extends Document {
  userId: Types.ObjectId;
  integrationId: string;
  type: ApiKeyType;
  key: string;
  createdAt: Date;
}

const ApiKeySchema: Schema<IApiKey> = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    integrationId: { type: String, required: true, index: true },
    type: { type: String, enum: ["apiKey", "oauth2"], required: true },
    key: { type: String, required: true },
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
