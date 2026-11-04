"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import prisma from "@repo/db/client";
import { p2pTransfer, WalletError } from "@repo/wallet";
import { authOptions } from "../auth";

const input = z.object({
    phone: z.string().trim().regex(/^\d{10}$/, "Enter a 10 digit phone number"),
    // entered in INR, stored in paise
    amount: z.coerce.number().positive("Amount must be greater than 0").max(10_000_000),
    idempotencyKey: z.string().uuid(),
});

export type P2pActionState = { ok: boolean; message: string };

export async function sendP2p(_prev: P2pActionState | null, formData: FormData): Promise<P2pActionState> {
    const session = await getServerSession(authOptions);
    const fromUserId = Number(session?.user?.id);
    if (!fromUserId) {
        return { ok: false, message: "Not signed in" };
    }

    const parsed = input.safeParse({
        phone: formData.get("phone"),
        amount: formData.get("amount"),
        idempotencyKey: formData.get("idempotencyKey"),
    });
    if (!parsed.success) {
        return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    try {
        const result = await p2pTransfer(
            prisma,
            fromUserId,
            parsed.data.phone,
            Math.round(parsed.data.amount * 100),
            parsed.data.idempotencyKey
        );
        revalidatePath("/p2p");
        return { ok: true, message: result.replayed ? "Transfer already completed" : "Transfer successful" };
    } catch (e) {
        if (e instanceof WalletError) {
            return { ok: false, message: e.message };
        }
        console.error(e);
        return { ok: false, message: "Something went wrong" };
    }
}
