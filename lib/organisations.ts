import mongoose from "mongoose";

import { Organisation } from "@/lib/models/organisation";
import { User } from "@/lib/models/user";

export const DEFAULT_ORGANISATION_SLUG = "lnp";
export const DEFAULT_ORGANISATION_NAME = "LNP";

type OrganisationWithId = {
  _id: mongoose.Types.ObjectId;
  slug: string;
  name: string;
};

type UserOrganisationWithDetails = {
  organisation: OrganisationWithId;
};

export async function ensureDefaultOrganisation() {
  const organisation = await Organisation.findOneAndUpdate(
    { slug: DEFAULT_ORGANISATION_SLUG },
    {
      slug: DEFAULT_ORGANISATION_SLUG,
      name: DEFAULT_ORGANISATION_NAME,
      isDefault: true,
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  ).lean();

  if (!organisation) {
    throw new Error("Failed to ensure default organisation");
  }

  return organisation;
}

export async function ensureUserOrganisation(
  userId: string | mongoose.Types.ObjectId
): Promise<UserOrganisationWithDetails> {
  const organisation = await ensureDefaultOrganisation();
  const normalizedUserId =
    typeof userId === "string" ? new mongoose.Types.ObjectId(userId) : userId;

  await User.updateOne(
    { _id: normalizedUserId },
    { $set: { organisationId: organisation._id } }
  );

  return {
    organisation: {
      _id: organisation._id,
      slug: organisation.slug,
      name: organisation.name,
    },
  };
}
