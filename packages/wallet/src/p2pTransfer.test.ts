import prisma from "@repo/db/client";
import { p2pTransfer, WalletError } from "./index";
import { resetDb, createUser, balanceOf } from "./testUtils";

let alice: { id: number; number: string };
let bob: { id: number; number: string };

beforeEach(async () => {
    await resetDb();
    alice = await createUser("1111111111", 10000);
    bob = await createUser("2222222222", 500);
});

afterAll(async () => {
    await prisma.$disconnect();
});

const code = (p: Promise<unknown>) => p.then(() => null, (e: WalletError) => e.code);

test("successful transfer moves money and records the transfer", async () => {
    const result = await p2pTransfer(prisma, alice.id, bob.number, 2500, "key-1");

    expect(result).toMatchObject({ fromUserId: alice.id, toUserId: bob.id, amount: 2500, replayed: false });
    expect(await balanceOf(alice.id)).toBe(7500);
    expect(await balanceOf(bob.id)).toBe(3000);
    expect(await prisma.p2pTransfer.count()).toBe(1);
});

test("insufficient funds is rejected and nothing changes", async () => {
    expect(await code(p2pTransfer(prisma, alice.id, bob.number, 10001, "key-1"))).toBe("INSUFFICIENT_FUNDS");

    expect(await balanceOf(alice.id)).toBe(10000);
    expect(await balanceOf(bob.id)).toBe(500);
    expect(await prisma.p2pTransfer.count()).toBe(0);
});

test("rejects non-positive amounts, self-transfers and unknown recipients", async () => {
    expect(await code(p2pTransfer(prisma, alice.id, bob.number, 0, "k1"))).toBe("INVALID_AMOUNT");
    expect(await code(p2pTransfer(prisma, alice.id, bob.number, -5, "k2"))).toBe("INVALID_AMOUNT");
    expect(await code(p2pTransfer(prisma, alice.id, alice.number, 100, "k3"))).toBe("SELF_TRANSFER");
    expect(await code(p2pTransfer(prisma, alice.id, "9999999999", 100, "k4"))).toBe("RECIPIENT_NOT_FOUND");
    expect(await balanceOf(alice.id)).toBe(10000);
});

test("a repeated idempotency key returns the original transfer and moves money once", async () => {
    const first = await p2pTransfer(prisma, alice.id, bob.number, 1000, "same-key");
    const second = await p2pTransfer(prisma, alice.id, bob.number, 1000, "same-key");

    expect(second.id).toBe(first.id);
    expect(second.replayed).toBe(true);
    expect(await balanceOf(alice.id)).toBe(9000);
    expect(await balanceOf(bob.id)).toBe(1500);
    expect(await prisma.p2pTransfer.count()).toBe(1);
});

test("concurrent requests with the same idempotency key move money once", async () => {
    const results = await Promise.all(
        Array.from({ length: 5 }, () => p2pTransfer(prisma, alice.id, bob.number, 1000, "race-key"))
    );

    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await balanceOf(alice.id)).toBe(9000);
    expect(await prisma.p2pTransfer.count()).toBe(1);
});

test("two parallel transfers that together would overdraw: only one succeeds", async () => {
    const outcomes = await Promise.allSettled([
        p2pTransfer(prisma, alice.id, bob.number, 7000, "overdraw-a"),
        p2pTransfer(prisma, alice.id, bob.number, 7000, "overdraw-b"),
    ]);

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as WalletError).code).toBe("INSUFFICIENT_FUNDS");
    expect(await balanceOf(alice.id)).toBe(3000);
    expect(await balanceOf(bob.id)).toBe(7500);
});

test("opposing simultaneous transfers do not deadlock", async () => {
    await Promise.all([
        ...Array.from({ length: 5 }, (_, i) => p2pTransfer(prisma, alice.id, bob.number, 100, `a-${i}`)),
        ...Array.from({ length: 5 }, (_, i) => p2pTransfer(prisma, bob.id, alice.number, 100, `b-${i}`)),
    ]);

    expect(await balanceOf(alice.id)).toBe(10000);
    expect(await balanceOf(bob.id)).toBe(500);
    expect(await prisma.p2pTransfer.count()).toBe(10);
});
