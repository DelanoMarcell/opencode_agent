import mongoose, { Schema, type InferSchemaType } from "mongoose";

const ms365AllowedLocationSchema = new Schema(
  {
    organisationId: {
      type: Schema.Types.ObjectId,
      ref: "Organisation",
      required: true,
      index: true,
    },
    id: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    siteId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    driveId: {
      type: String,
      trim: true,
    },
    rootItemId: {
      type: String,
      trim: true,
    },
    webUrl: {
      type: String,
      trim: true,
    },
    sourceUrl: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

ms365AllowedLocationSchema.index({ organisationId: 1, id: 1 }, { unique: true });
ms365AllowedLocationSchema.index({ organisationId: 1, sourceUrl: 1 }, { unique: true });

export type IMs365AllowedLocation = InferSchemaType<typeof ms365AllowedLocationSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Ms365AllowedLocationModel =
  mongoose.models.Ms365AllowedLocation ||
  mongoose.model("Ms365AllowedLocation", ms365AllowedLocationSchema);
