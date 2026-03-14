import mongoose, { Schema, type InferSchemaType } from "mongoose";

// Maps a tracked OpenCode session to a matter.
const matterSessionSchema = new Schema(
  {
    matterId: {
      type: Schema.Types.ObjectId,
      ref: "Matter",
      required: true,
      index: true,
    },
    // Points to the tracked session row, not directly to the raw OpenCode session id.
    opencodeSessionId: {
      type: Schema.Types.ObjectId,
      ref: "OpencodeSession",
      required: true,
      unique: true,
      index: true,
    },
    // Tracks who linked the session to the matter, which can differ from who created it.
    addedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

matterSessionSchema.index({ matterId: 1, opencodeSessionId: 1 }, { unique: true });

export type IMatterSession = InferSchemaType<typeof matterSessionSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const MatterSession =
  mongoose.models.MatterSession ||
  mongoose.model("MatterSession", matterSessionSchema);

/*
Example document:
{
  _id: ObjectId("67d1a350c8e4b2a91f003444"),
  matterId: ObjectId("67d1a1f0c8e4b2a91f001111"),
  opencodeSessionId: ObjectId("67d1a300c8e4b2a91f003333"),
  addedByUserId: ObjectId("67d19f80c8e4b2a91f000101"),
  createdAt: ISODate("2026-03-14T09:06:00.000Z")
}

Meaning:
- the tracked session is assigned to the matter
- the session itself can belong to at most one matter because opencodeSessionId is unique here
- addedByUserId records who performed the matter assignment
*/
