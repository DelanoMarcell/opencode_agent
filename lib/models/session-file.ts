import mongoose, { Schema, type InferSchemaType } from "mongoose";

// Stores metadata for files uploaded into a specific OpenCode session.
const sessionFileSchema = new Schema(
  {
    organisationId: {
      type: Schema.Types.ObjectId,
      ref: "Organisation",
      required: true,
      index: true,
    },
    opencodeSessionId: {
      type: Schema.Types.ObjectId,
      ref: "OpencodeSession",
      required: true,
      index: true,
    },
    rawSessionId: {
      type: String,
      required: true,
      trim: true,
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

sessionFileSchema.index({ organisationId: 1, rawSessionId: 1, createdAt: -1 });
sessionFileSchema.index({ organisationId: 1, opencodeSessionId: 1, createdAt: -1 });
sessionFileSchema.index({ opencodeSessionId: 1, storedName: 1 }, { unique: true });
sessionFileSchema.index({ opencodeSessionId: 1, checksumSha256: 1 }, { unique: true });

export type ISessionFile = InferSchemaType<typeof sessionFileSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const SessionFile =
  mongoose.models.SessionFile || mongoose.model("SessionFile", sessionFileSchema);

/*
Example document:
{
  _id: ObjectId("67d1a300c8e4b2a91f004444"),
  organisationId: ObjectId("67d19f80c8e4b2a91f000001"),
  opencodeSessionId: ObjectId("67d1a300c8e4b2a91f003333"),
  rawSessionId: "ses_abc123xyz789",
  fileId: "sf_abc123xyz789",
  originalName: "termination-letter.pdf",
  source: "device",
  ms365LocationId: undefined,
  ms365DriveId: undefined,
  ms365ItemId: undefined,
  ms365WebUrl: undefined,
  storedName: "termination-letter (1).pdf",
  relativePath: "LNP/ses_abc123xyz789/termination-letter (1).pdf",
  checksumSha256: "7b7f3d2f0b7f5a39d9d7ec3a6a4a7e8f2f5e8910213e2f3cd1ab23cd45ef6789",
  mime: "application/pdf",
  size: 182331,
  createdByUserId: ObjectId("67d19f80c8e4b2a91f000101"),
  createdAt: ISODate("2026-03-22T09:05:00.000Z"),
  updatedAt: ISODate("2026-03-22T09:05:00.000Z")
}

Meaning:
- this file belongs to one chat session
- the bytes live on disk under the session folder
- the database row stores the metadata, ownership, and exact-content checksum for the uploaded file
*/
