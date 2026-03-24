import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/mongodb";
import { ensureDefaultOrganisation, ensureUserOrganisation } from "@/lib/organisations";
import { Organisation } from "@/lib/models/organisation";
import { User } from "@/lib/models/user";

/**
 * Full auth flow:
 *
 * 1. User submits email + password on /auth/sign-in.
 * 2. The form calls signIn("credentials", { email, password }) from next-auth/react.
 * 3. NextAuth routes the request to authorize() in the Credentials provider below.
 * 4. authorize() connects to MongoDB, finds the user by email, and verifies
 *    the password against the stored bcrypt hash.
 * 5. If valid, authorize() returns { id, email, name }. If invalid, returns null
 *    and NextAuth rejects the sign-in.
 * 6. On success, the jwt() callback fires — it copies id/email/name from the
 *    returned user object into an encrypted JWT cookie.
 * 7. On every subsequent request, the jwt() callback fires again. This time
 *    `user` is undefined (sign-in already happened), so the token passes
 *    through unchanged — the fields from step 6 are already baked in.
 * 8. When server code calls getServerSession(authOptions), or a client component
 *    calls useSession(), the session() callback fires. It reads the JWT token
 *    and maps its fields onto session.user so your app can access them.
 */
export const authOptions: NextAuthOptions = {
  // JWT strategy: sessions live in an encrypted cookie, not in a database.
  // This means no DB adapter is needed — we manage the users table ourselves.
  session: { strategy: "jwt" },

  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },

      /**
       * Step 3–5 of the flow.
       *
       * Triggered when signIn("credentials", { email, password }) is called.
       * Connects to MongoDB, queries the users collection for a matching email,
       * then uses bcrypt.compare() to check the plain-text password against the
       * stored hash. Returns the user object on success (NextAuth will pass this
       * to the jwt callback), or null to deny access.
       */
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        await connectDB();

        const user = await User.findOne({ email: credentials.email.toLowerCase() });
        if (!user) return null;

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) return null;

        const organisation = user.organisationId
          ? await Organisation.findById(user.organisationId).lean()
          : null;
        const resolvedOrganisation = organisation ?? (await ensureDefaultOrganisation());

        if (!user.organisationId) {
          await ensureUserOrganisation(user._id);
        }

        return {
          id: user._id.toString(),
          email: user.email,
          name: user.name ?? null,
          organisationId: resolvedOrganisation._id.toString(),
          organisationSlug: resolvedOrganisation.slug,
          organisationName: resolvedOrganisation.name,
        };
      },
    }),
  ],

  // Override NextAuth's default /api/auth/signin with our custom page.
  // Any middleware redirect or signIn() call without a valid session lands here.
  pages: {
    signIn: "/auth/sign-in",
  },

  callbacks: {
    /**
     * Step 6–7 of the flow.
     *
     * Fires on EVERY request that touches the session.
     *
     * First call (sign-in): `user` contains { id, email, name } from authorize().
     * We copy those fields onto `token`, which NextAuth encrypts into a cookie.
     *
     * All later calls: `user` is undefined (no sign-in happened). The token
     * already carries the fields from the first call, so we return it as-is.
     */
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email ?? undefined;
        token.name = user.name;
        token.organisationId = user.organisationId;
        token.organisationSlug = user.organisationSlug;
        token.organisationName = user.organisationName;
      }
      return token;
    },

    /**
     * Step 8 of the flow.
     *
     * Fires when getServerSession(authOptions) or useSession() is called.
     * The `token` arg is the decrypted JWT cookie. We map its custom fields
     * (id, email, name) onto session.user so the rest of the app can read
     * them via session.user.id, session.user.email, etc.
     */
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id: string }).id = token.id as string;
        session.user.email = token.email as string;
        session.user.name = token.name as string | null;
        session.user.organisationId = token.organisationId as string;
        session.user.organisationSlug = token.organisationSlug as string;
        session.user.organisationName = token.organisationName as string;
      }
      return session;
    },
  },
};
