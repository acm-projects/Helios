import mongoose, { Document, Model, Schema, Types } from "mongoose";

export interface IntegrationEndpoint {
  method: string;
  path: string;
  parameters: any[];
  security: any[];
}

export interface IIntegration extends Document {
  userId: Types.ObjectId;
  integrationId: string;
  name: string;
  authType: string;
  specLocation: string;
  status: string;
  keyLocation: string | null;
  lastValidatedAt: Date | null;
  expiresAt: Date | null;
  baseUrl: string;
  securitySchemes: any[];
  endpoints: IntegrationEndpoint[];
  createdAt: Date;
  updatedAt: Date;
}

const IntegrationEndpointSchema = new Schema(
  {
    method: { type: String, required: true },
    path: { type: String, required: true },
    parameters: { type: [Schema.Types.Mixed], default: [] },
    security: { type: [Schema.Types.Mixed], default: [] },
  },
  { _id: false }
);

const IntegrationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    integrationId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    authType: { type: String, default: "none" },
    specLocation: { type: String, default: "" },
    status: { type: String, enum: ["pending", "active", "error"], default: "pending" },
    keyLocation: { type: String, default: null },
    lastValidatedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    baseUrl: { type: String, default: "" },
    securitySchemes: { type: [Schema.Types.Mixed], default: [] },
    endpoints: { type: [IntegrationEndpointSchema], default: [] },
  },
  {
    collection: "connections",
    timestamps: true,
  }
);

IntegrationSchema.index({ userId: 1, integrationId: 1 }, { unique: true });

export const Integration: Model<IIntegration> =
  (mongoose.models.Integration as Model<IIntegration>) ||
  mongoose.model<IIntegration>("Integration", IntegrationSchema);
