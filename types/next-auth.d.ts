import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string | null;
      organisationId: string;
      organisationSlug: string;
      organisationName: string;
    };
  }

  interface User {
    organisationId: string;
    organisationSlug: string;
    organisationName: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    email?: string;
    name?: string | null;
    organisationId?: string;
    organisationSlug?: string;
    organisationName?: string;
  }
}
