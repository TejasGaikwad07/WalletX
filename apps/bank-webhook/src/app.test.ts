import crypto from "crypto";
import request from "supertest";
import prisma from "@repo/db/client";
import { createApp } from "./app";

const SECRET = "test-secret";
const app = createApp(SECRET);

const sign = (body: string, secret = SECRET) => crypto.createHmac("sha256", secret).update(body).digest("hex");

function post(payload: object, signature?: string) {
    const body = JSON.stringify(payload);
    return request(app)
        .post("/hdfcWebhook")
        .set("Content-Type", "application/json")
        .set("x-signature", signature ?? sign(body))
        .send(body);
}

let userId: number;

beforeEach(async () => {
    await prisma.$executeRawUnsafe(
        'TRUNCATE "P2pTransfer", "OnRampTransaction", "Balance", "User" RESTART IDENTITY CASCADE'
    );
    const user = await prisma.user.create({
        data: {
            number: "1111111111",
            password: "x",
            Balance: { create: { amount: 1000, locked: 0 } },
            OnRampTransaction: {
                create: { status: "Processing", token: "tok-1", provider: "HDFC Bank", amount: 5000, startTime: new Date() },
            },
        },
    });
    userId = user.id;
});

afterAll(async () => {
    await prisma.$disconnect();
});

const balance = async () => (await prisma.balance.findUniqueOrThrow({ where: { userId } })).amount;

test("valid webhook credits the balance and marks the transaction Success", async () => {
    const res = await post({ token: "tok-1", user_identifier: String(userId), amount: "5000" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Captured");
    expect(await balance()).toBe(6000);
    expect((await prisma.onRampTransaction.findUniqueOrThrow({ where: { token: "tok-1" } })).status).toBe("Success");
});

test("replaying the same webhook credits exactly once", async () => {
    const payload = { token: "tok-1", user_identifier: String(userId), amount: "5000" };

    expect((await post(payload)).body.message).toBe("Captured");
    const replay = await post(payload);

    expect(replay.status).toBe(200);
    expect(replay.body.message).toBe("Already processed");
    expect(await balance()).toBe(6000);
});

test("concurrent replays credit exactly once", async () => {
    const payload = { token: "tok-1", user_identifier: String(userId), amount: "5000" };
    await Promise.all(Array.from({ length: 5 }, () => post(payload)));

    expect(await balance()).toBe(6000);
});

test("missing or wrong signature is rejected and nothing is credited", async () => {
    const payload = { token: "tok-1", user_identifier: String(userId), amount: "5000" };

    const missing = await request(app).post("/hdfcWebhook").send(payload);
    const wrong = await post(payload, sign(JSON.stringify(payload), "other-secret"));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(await balance()).toBe(1000);
});

test("invalid payload is rejected", async () => {
    expect((await post({ token: "tok-1", user_identifier: String(userId), amount: "-5" })).status).toBe(400);
    expect((await post({ user_identifier: String(userId), amount: "5000" })).status).toBe(400);
    expect(await balance()).toBe(1000);
});

test("a webhook whose amount does not match the transaction is not credited", async () => {
    const res = await post({ token: "tok-1", user_identifier: String(userId), amount: "999999" });

    expect(res.status).toBe(404);
    expect(await balance()).toBe(1000);
});
