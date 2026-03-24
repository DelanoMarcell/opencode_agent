import mongoose, { Schema, type InferSchemaType } from "mongoose";

// Stores metadata for files uploaded into a specific matter library.
const matterFileSchema = new Schema(
  {
    organisationId: {
      type: Schema.Types.ObjectId,
      ref: "Organisation",
      required: true,
      index: true,
    },
    matterId: {
      type: Schema.Types.ObjectId,
      ref: "Matter",
      required: true,
      index: true,
    },
    fileId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    originalName: {
      type: String,
      required: true,
      trim: true,
    },
    source: {
      type: String,
      required: true,
      enum: ["device", "ms365"],
      trim: true,
    },
    ms365LocationId: {
      type: String,
      trim: true,
    },
    ms365DriveId: {
      type: String,
      trim: true,
    },
    ms365ItemId: {
      type: String,
      trim: true,
    },
    ms365WebUrl: {
      type: String,
      trim: true,
    },
    storedName: {
      type: String,
      required: true,
      trim: true,
    },
    relativePath: {
      type: String,
      required: true,
      trim: true,
    },
    checksumSha256: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      minlength: 64,
      maxlength: 64,
    },
    mime: {
      type: String,
      trim: true,
    },
    size: {
      type: Number,
      required: true,
      min: 0,
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

matterFileSchema.index({ organisationId: 1, matterId: 1, createdAt: -1 });
matterFileSchema.index({ matterId: 1, storedName: 1 }, { unique: true });
matterFileSchema.index({ matterId: 1, checksumSha256: 1 }, { unique: true });

export type IMatterFile = InferSchemaType<typeof matterFileSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const MatterFile =
  mongoose.models.MatterFile || mongoose.model("MatterFile", matterFileSchema);
