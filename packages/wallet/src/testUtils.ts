import prisma from "@repo/db/client";

export async function resetDb() {
    await prisma.$executeRawUnsafe(
        'TRUNCATE "P2pTransfer", "OnRampTransaction", "Balance", "User" RESTART IDENTITY CASCADE'
    );
}

export async function createUser(number: string, balance: number) {
    const user = await prisma.user.create({
        data: { number, password: "x", Balance: { create: { amount: balance, locked: 0 } } },
    });
    return { ...user, number };
}

export async function balanceOf(userId: number) {
    const b = await prisma.balance.findUniqueOrThrow({ where: { userId } });
    return b.amount;
}
