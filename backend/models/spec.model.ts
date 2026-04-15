import mongoose, { Document, Model, Schema, Types } from "mongoose";

export interface ISpec extends Document {
  _id: string;
  userId: Types.ObjectId;
  type?: string;
  baseUrl?: string;
  toolCount?: number;
  createdAt?: string;
  catalog?: any[];
  auth?: any[];
  groupMap?: Record<string, string>;
  authMap?: Record<string, any[]>;
  starX?: number;
  starY?: number;
}

const SpecSchema = new Schema<ISpec>(
  {
    _id: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    type: { type: String, default: null },
    baseUrl: { type: String, default: "" },
    toolCount: { type: Number, default: 0 },
    createdAt: { type: String, default: null },
    catalog: { type: [Schema.Types.Mixed], default: [] },
    auth: { type: [Schema.Types.Mixed], default: [] },
    groupMap: { type: Schema.Types.Mixed, default: null },
    authMap: { type: Schema.Types.Mixed, default: null },
    starX: { type: Number, default: null },
    starY: { type: Number, default: null },
  },
  {
    collection: "specs",
    timestamps: false,
  }
)

SpecSchema.index({ userId: 1, _id: 1 }, { unique: true })

export const Spec: Model<ISpec> =
  (mongoose.models.Spec as Model<ISpec>) ||
  mongoose.model<ISpec>("Spec", SpecSchema)
