import mongoose, { Schema, type InferSchemaType } from "mongoose";

// Stores the top-level matter record that groups related OpenCode sessions.
const matterSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    // Keeps creator attribution even though all current users are members in V1.
    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
      required: true,
    },
  },
  { timestamps: true }
);

export type IMatter = InferSchemaType<typeof matterSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Matter =
  mongoose.models.Matter || mongoose.model("Matter", matterSchema);

/*
Example document:
{
  _id: ObjectId("67d1a1f0c8e4b2a91f001111"),
  code: "MATTER12868",
  title: "Dispute Between X and Y",
  description: "Contract dispute covering correspondence and litigation prep.",
  ownerUserId: ObjectId("67d19f80c8e4b2a91f000101"),
  status: "active",
  createdAt: ISODate("2026-03-14T09:00:00.000Z"),
  updatedAt: ISODate("2026-03-14T09:00:00.000Z")
}

Meaning:
- one matter folder in the app
- created by the user in ownerUserId
- can later have many members and many linked sessions
*/
