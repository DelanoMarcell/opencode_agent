import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import AzureADProvider from "next-auth/providers/azure-ad";

/**
 * Calls Microsoft's token endpoint to exchange a refresh token
 * for a new access token. Returns the updated token fields.
 */
async function refreshAccessToken(token: JWT): Promise<JWT> {
  const res = await fetch(
    "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken as string,
      }),
    }
  );

  const tokens = await res.json();

  if (!res.ok) {
    // Refresh failed — mark the token so downstream code can handle it
    return { ...token, error: "RefreshAccessTokenError" };
  }

  return {
    ...token,
    accessToken: tokens.access_token,
    // Microsoft may rotate the refresh token — use the new one if provided
    refreshToken: tokens.refresh_token ?? token.refreshToken,
    // expires_in is in seconds; convert to an absolute unix timestamp
    expiresAt: Math.floor(Date.now() / 1000) + tokens.expires_in,
  };
}

export const authOptions: NextAuthOptions = {
  providers: [
    AzureADProvider({
      id: "microsoft",
      name: "Microsoft",
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      authorization: {
        params: {
          scope:
            "openid profile email offline_access User.Read Mail.Read Files.Read Sites.Read.All",
        },
      },
    }),
  ],
  pages: {
    signIn: "/auth",
  },
  callbacks: {
    /**
     * jwt callback — runs every time the JWT is created or read.
     *
     * `account` is only present on the initial sign-in (the raw OAuth
     * response from Microsoft). On subsequent requests it's undefined,
     * so we use the `if (account)` check to save the tokens once and
     * then let them ride in the cookie from that point on.
     */
    async jwt({ token, account }) {
      // First sign-in: persist the Microsoft tokens into the JWT
      if (account) {
        console.log("[Auth] Access Token:", account.access_token);
        console.log("[Auth] Refresh Token:", account.refresh_token);
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
        return token;
      }

      // Access token hasn't expired yet — return as-is
      if (Date.now() < (token.expiresAt as number) * 1000) {
        return token;
      }

      // Access token has expired — use the refresh token to get a new one
      return await refreshAccessToken(token);
    },

    // async signIn({ user }) {
    //   if (!user.email?.endsWith("@nexabeyond.com")) {
    //     return false;
    //   }
    //   return true;
    // },

    async redirect({ baseUrl }) {
      return `${baseUrl}/dashboard`;
    },
  },
};
