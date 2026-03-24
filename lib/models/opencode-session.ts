import mongoose, { Schema, type InferSchemaType } from "mongoose";

// Stores app-side metadata for each OpenCode session, including who created it.
const opencodeSessionSchema = new Schema(
  {
    organisationId: {
      type: Schema.Types.ObjectId,
      ref: "Organisation",
      required: true,
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      trim: true,
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
  title: "Chronology draft",
  createdByUserId: ObjectId("67d19f80c8e4b2a91f000101"),
  createdAt: ISODate("2026-03-14T09:05:00.000Z")
}

Meaning:
- this is one app-side session record for an OpenCode session
- title is the app-managed display name when one exists
- the actual conversation content still lives in OpenCode
- the app uses this row to know who created the session, even if it is never assigned to a matter
*/
