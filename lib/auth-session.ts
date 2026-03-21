import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";

export type AuthenticatedOrganisationUser = {
  id: string;
  email: string;
  name: string | null;
  organisationId: string;
  organisationSlug: string;
  organisationName: string;
};

export async function getAuthenticatedOrganisationUser(): Promise<AuthenticatedOrganisationUser | null> {
  // Read the signed-in user and their active organisation context from the NextAuth session.
  const session = await getServerSession(authOptions);

  if (
    !session?.user?.id ||
    !session.user.email ||
    !session.user.organisationId ||
    !session.user.organisationSlug ||
    !session.user.organisationName
  ) {
    return null;
  }

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    organisationId: session.user.organisationId,
    organisationSlug: session.user.organisationSlug,
    organisationName: session.user.organisationName,
  };
}
