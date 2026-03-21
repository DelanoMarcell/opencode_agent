import mongoose, { Schema, type InferSchemaType } from "mongoose";

const organisationSchema = new Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
      required: true,
    },
  },
  { timestamps: true }
);

organisationSchema.index(
  { isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } }
);

export type IOrganisation = InferSchemaType<typeof organisationSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Organisation =
  mongoose.models.Organisation || mongoose.model("Organisation", organisationSchema);
