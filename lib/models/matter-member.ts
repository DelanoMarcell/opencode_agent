import mongoose, { Schema, type InferSchemaType } from "mongoose";

// Stores which users can access a given matter.
const matterMemberSchema = new Schema(
  {
    matterId: {
      type: Schema.Types.ObjectId,
      ref: "Matter",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

// Prevents the same user from being added to the same matter more than once.
matterMemberSchema.index({ matterId: 1, userId: 1 }, { unique: true });

export type IMatterMember = InferSchemaType<typeof matterMemberSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const MatterMember =
  mongoose.models.MatterMember ||
  mongoose.model("MatterMember", matterMemberSchema);

/*
Example document:
{
  _id: ObjectId("67d1a250c8e4b2a91f002222"),
  matterId: ObjectId("67d1a1f0c8e4b2a91f001111"),
  userId: ObjectId("67d19f80c8e4b2a91f000101"),
  createdAt: ISODate("2026-03-14T09:01:00.000Z"),
  updatedAt: ISODate("2026-03-14T09:01:00.000Z")
}

Meaning:
- this user has access to that matter
- multiple rows can exist for the same matter, one per user
- in V1, a newly created matter will get one of these rows for every current user
*/
