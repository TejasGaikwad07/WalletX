import { Prisma } from "@prisma/client";
import type { PrismaClient, User } from "@prisma/client";
import { z } from "zod";
import { WalletError } from "./p2pTransfer";

export const phoneSchema = z.string().trim().regex(/^\d{10}$/, "Enter a 10 digit phone number");

export interface GoogleProfile {
    email: string;
    name?: string | null;
    emailVerified: boolean;
}

const isUniqueViolation = (e: unknown) =>
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/**
 * Finds the user for a Google sign-in by email, or creates one. Does not call Google, so it can be tested directly.
 * - Returning or pre-existing users (matched by email) are linked as-is; a missing Balance row is created.
 * - New users get their Balance row (0 / 0) in the same transaction.
 * Only verified Google emails are accepted, otherwise someone could take over an account by claiming its email.
 */
export async function findOrCreateGoogleUser(db: PrismaClient, profile: GoogleProfile): Promise<User> {
    if (!profile.emailVerified) {
        throw new WalletError("UNVERIFIED_EMAIL", "Google account email is not verified");
    }
    const email = profile.email.trim().toLowerCase();

    const attempt = () =>
        db.$transaction(async (tx) => {
            const existing = await tx.user.findUnique({ where: { email }, include: { Balance: true } });
            if (existing) {
                if (existing.Balance.length === 0) {
                    await tx.balance.create({ data: { userId: existing.id, amount: 0, locked: 0 } });
                }
                const { Balance: _balance, ...user } = existing;
                return user;
            }
            return tx.user.create({
                data: { email, name: profile.name ?? null, Balance: { create: { amount: 0, locked: 0 } } },
            });
        });

    try {
        return await attempt();
    } catch (e) {
        // Two first-time sign-ins racing on the same email: the loser re-reads the winner's row.
        if (isUniqueViolation(e)) return attempt();
        throw e;
    }
}

/** Sets the phone number of a user who has none. The number must be 10 digits and unused. */
export async function setPhoneNumber(db: PrismaClient, userId: number, phone: string): Promise<User> {
    const parsed = phoneSchema.safeParse(phone);
    if (!parsed.success) {
        throw new WalletError("INVALID_PHONE", parsed.error.issues[0]?.message ?? "Invalid phone number");
    }
    const number = parsed.data;

    const owner = await db.user.findUnique({ where: { number } });
    if (owner && owner.id !== userId) {
        throw new WalletError("PHONE_TAKEN", "That phone number is already in use");
    }

    try {
        // Conditional on number IS NULL so an existing number cannot be silently replaced.
        const result = await db.user.updateMany({ where: { id: userId, number: null }, data: { number } });
        if (result.count === 0) {
            throw new WalletError("PHONE_ALREADY_SET", "This account already has a phone number");
        }
    } catch (e) {
        if (isUniqueViolation(e)) {
            throw new WalletError("PHONE_TAKEN", "That phone number is already in use");
        }
        throw e;
    }
    return db.user.findUniqueOrThrow({ where: { id: userId } });
}
