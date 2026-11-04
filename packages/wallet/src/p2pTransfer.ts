import type { PrismaClient } from "@prisma/client";

export type WalletErrorCode =
    | "INVALID_AMOUNT"
    | "INVALID_IDEMPOTENCY_KEY"
    | "RECIPIENT_NOT_FOUND"
    | "SELF_TRANSFER"
    | "NO_BALANCE"
    | "INSUFFICIENT_FUNDS"
    | "INVALID_PHONE"
    | "PHONE_TAKEN"
    | "PHONE_ALREADY_SET"
    | "UNVERIFIED_EMAIL";

export class WalletError extends Error {
    constructor(public readonly code: WalletErrorCode, message: string) {
        super(message);
        this.name = "WalletError";
    }
}

export interface P2pTransferResult {
    id: number;
    fromUserId: number;
    toUserId: number;
    amount: number;
    idempotencyKey: string;
    createdAt: Date;
    /** true when this call returned a transfer created by an earlier call with the same key */
    replayed: boolean;
}

/**
 * Moves `amount` (in the smallest currency unit) from `fromUserId` to the user with phone `toPhone`.
 * Safe to retry with the same `idempotencyKey`: money moves at most once per (sender, key).
 */
export async function p2pTransfer(
    db: PrismaClient,
    fromUserId: number,
    toPhone: string,
    amount: number,
    idempotencyKey: string
): Promise<P2pTransferResult> {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new WalletError("INVALID_AMOUNT", "Amount must be a positive whole number");
    }
    if (!idempotencyKey) {
        throw new WalletError("INVALID_IDEMPOTENCY_KEY", "An idempotency key is required");
    }

    return db.$transaction(async (tx) => {
        const recipient = await tx.user.findUnique({ where: { number: toPhone } });
        if (!recipient) {
            throw new WalletError("RECIPIENT_NOT_FOUND", "No user with that phone number");
        }
        if (recipient.id === fromUserId) {
            throw new WalletError("SELF_TRANSFER", "You cannot send money to yourself");
        }

        // Lock both balance rows, lowest userId first, so two opposing transfers cannot deadlock.
        // Every transfer from the same sender needs this lock, so duplicate keys are serialized too.
        const ids = [fromUserId, recipient.id].sort((a, b) => a - b);
        const locked = await tx.$queryRaw<{ userId: number; amount: number }[]>`
            SELECT "userId", "amount" FROM "Balance"
            WHERE "userId" IN (${ids[0]}, ${ids[1]})
            ORDER BY "userId" ASC
            FOR UPDATE`;
        const senderBalance = locked.find((b) => b.userId === fromUserId);
        if (!senderBalance || !locked.some((b) => b.userId === recipient.id)) {
            throw new WalletError("NO_BALANCE", "Sender or recipient has no wallet balance");
        }

        const existing = await tx.p2pTransfer.findUnique({
            where: { fromUserId_idempotencyKey: { fromUserId, idempotencyKey } },
        });
        if (existing) {
            return { ...existing, replayed: true };
        }

        if (senderBalance.amount < amount) {
            throw new WalletError("INSUFFICIENT_FUNDS", "Insufficient balance");
        }

        await tx.balance.update({ where: { userId: fromUserId }, data: { amount: { decrement: amount } } });
        await tx.balance.update({ where: { userId: recipient.id }, data: { amount: { increment: amount } } });
        const transfer = await tx.p2pTransfer.create({
            data: { fromUserId, toUserId: recipient.id, amount, idempotencyKey },
        });
        return { ...transfer, replayed: false };
    });
}
