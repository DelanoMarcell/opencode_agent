import mongoose, { Schema, type InferSchemaType } from "mongoose";

// Stores app-side metadata for each OpenCode session, including who created it.
const opencodeSessionSchema = new Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    createdByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export type IOpencodeSession = InferSchemaType<typeof opencodeSessionSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const OpencodeSession =
  mongoose.models.OpencodeSession ||
  mongoose.model("OpencodeSession", opencodeSessionSchema);

/*
Example document:
{
  _id: ObjectId("67d1a300c8e4b2a91f003333"),
  sessionId: "ses_abc123xyz789",
  createdByUserId: ObjectId("67d19f80c8e4b2a91f000101"),
  createdAt: ISODate("2026-03-14T09:05:00.000Z")
}

Meaning:
- this is one tracked OpenCode session
- the actual conversation content still lives in OpenCode
- the app uses this row to know who created the session, even if it is never assigned to a matter
*/
