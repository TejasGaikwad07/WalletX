import express from "express";
import crypto from "crypto";
import { z } from "zod";
import db from "@repo/db/client";

const webhookBody = z.object({
    token: z.string().min(1),
    user_identifier: z.coerce.number().int().positive(),
    amount: z.coerce.number().int().positive(),
});

export function verifySignature(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
    if (!signature) return false;
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
    const received = Buffer.from(signature, "hex");
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

export function createApp(secret: string | undefined = process.env.BANK_WEBHOOK_SECRET) {
    if (!secret) {
        throw new Error("BANK_WEBHOOK_SECRET must be set");
    }
    const app = express();

    app.use(express.json({
        verify: (req, _res, buf) => {
            (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
        },
    }));

    app.post("/hdfcWebhook", async (req, res) => {
        const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
        if (!verifySignature(rawBody, req.header("x-signature"), secret)) {
            return res.status(401).json({ message: "Invalid signature" });
        }

        const parsed = webhookBody.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({ message: "Invalid payload" });
        }
        const { token, user_identifier: userId, amount } = parsed.data;

        try {
            const outcome = await db.$transaction(async (tx) => {
                // The status flip is the single atomic gate: only one caller can move Processing -> Success.
                const claimed = await tx.onRampTransaction.updateMany({
                    where: { token, userId, amount, status: "Processing" },
                    data: { status: "Success" },
                });
                if (claimed.count === 0) {
                    const existing = await tx.onRampTransaction.findUnique({ where: { token } });
                    return existing && existing.userId === userId && existing.amount === amount
                        ? ("already_processed" as const)
                        : ("not_found" as const);
                }

                const credited = await tx.balance.updateMany({
                    where: { userId },
                    data: { amount: { increment: amount } },
                });
                if (credited.count !== 1) {
                    throw new Error("Balance row missing; rolling back");
                }
                return "captured" as const;
            });

            if (outcome === "not_found") {
                return res.status(404).json({ message: "No matching transaction" });
            }
            return res.json({ message: outcome === "captured" ? "Captured" : "Already processed" });
        } catch (e) {
            console.error(e);
            return res.status(500).json({ message: "Error while processing webhook" });
        }
    });

    return app;
}
