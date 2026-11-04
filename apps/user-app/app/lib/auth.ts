import db from "@repo/db/client";
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcrypt";
import { findOrCreateGoogleUser } from "@repo/wallet";

export const authOptions = {
    providers: [
      GoogleProvider({
          clientId: process.env.GOOGLE_CLIENT_ID ?? "",
          clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? ""
      }),
      CredentialsProvider({
          name: 'Credentials',
          credentials: {
            phone: { label: "Phone number", type: "text", placeholder: "1231231231", required: true },
            password: { label: "Password", type: "password", required: true }
          },
          // TODO: User credentials type from next-aut
          async authorize(credentials: any) {
            // Do zod validation, OTP validation here
            if (!credentials?.phone || !credentials?.password) {
                return null;
            }
            const existingUser = await db.user.findFirst({
                where: {
                    number: credentials.phone
                }
            });

            if (existingUser) {
                // Google-only accounts have no password and cannot use phone login
                if (!existingUser.password) {
                    return null;
                }
                const passwordValidation = await bcrypt.compare(credentials.password, existingUser.password);
                if (passwordValidation) {
                    return {
                        id: existingUser.id.toString(),
                        name: existingUser.name,
                        email: existingUser.number ?? existingUser.email
                    }
                }
                return null;
            }

            try {
                // Only hash when actually creating a user; the nested create makes user + balance one transaction
                const hashedPassword = await bcrypt.hash(credentials.password, 10);
                const user = await db.user.create({
                    data: {
                        number: credentials.phone,
                        password: hashedPassword,
                        Balance: {
                            create: { amount: 0, locked: 0 }
                        }
                    }
                });
            
                return {
                    id: user.id.toString(),
                    name: user.name,
                    email: user.number
                }
            } catch(e) {
                console.error(e);
            }

            return null
          },
        })
    ],
    secret: process.env.JWT_SECRET || "secret",
    callbacks: {
        async signIn({ account, profile }: any) {
            if (account?.provider === "google") {
                return Boolean(profile?.email && profile?.email_verified);
            }
            return true
        },
        // On Google sign-in, swap Google's subject id for our own User.id so the rest of the app is provider-agnostic
        async jwt({ token, account, profile }: any) {
            if (account?.provider === "google") {
                const user = await findOrCreateGoogleUser(db, {
                    email: profile.email,
                    name: profile.name,
                    emailVerified: Boolean(profile.email_verified)
                });
                token.sub = user.id.toString();
            }
            return token
        },
        // TODO: can u fix the type here? Using any is bad
        async session({ token, session }: any) {
            session.user.id = token.sub

            return session
        }
    }
  }
  