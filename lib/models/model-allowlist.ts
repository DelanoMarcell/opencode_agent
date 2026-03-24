import mongoose, { Schema, type InferSchemaType } from "mongoose";

const modelAllowlistSchema = new Schema(
  {
    organisationId: {
      type: Schema.Types.ObjectId,
      ref: "Organisation",
      required: true,
      unique: true,
      index: true,
    },
    allowedModelKeys: {
      type: [String],
      default: [],
    },
    defaultModelKey: {
      type: String,
      trim: true,
    },
    defaultVariant: {
      type: String,
      trim: true,
    },
    updatedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

export type IModelAllowlist = InferSchemaType<typeof modelAllowlistSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const ModelAllowlistModel =
  mongoose.models.ModelAllowlist ||
  mongoose.model("ModelAllowlist", modelAllowlistSchema);
