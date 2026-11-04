import prisma from "@repo/db/client";
import { findOrCreateGoogleUser, setPhoneNumber, WalletError } from "./index";
import { resetDb, createUser } from "./testUtils";

beforeEach(async () => {
    await resetDb();
});

afterAll(async () => {
    await prisma.$disconnect();
});

const code = (p: Promise<unknown>) => p.then(() => null, (e: WalletError) => e.code);
const profile = { email: "Ada@Example.com", name: "Ada", emailVerified: true };

describe("findOrCreateGoogleUser", () => {
    test("new Google user is created with email, name, no number and a zero Balance", async () => {
        const user = await findOrCreateGoogleUser(prisma, profile);

        expect(user).toMatchObject({ email: "ada@example.com", name: "Ada", number: null, password: null });
        const balances = await prisma.balance.findMany({ where: { userId: user.id } });
        expect(balances).toHaveLength(1);
        expect(balances[0]).toMatchObject({ amount: 0, locked: 0 });
    });

    test("returning Google user gets the same account and no duplicate Balance", async () => {
        const first = await findOrCreateGoogleUser(prisma, profile);
        const second = await findOrCreateGoogleUser(prisma, profile);

        expect(second.id).toBe(first.id);
        expect(await prisma.user.count()).toBe(1);
        expect(await prisma.balance.count()).toBe(1);
    });

    test("links to an existing user with the same email and keeps their data", async () => {
        const existing = await prisma.user.create({
            data: {
                email: "ada@example.com",
                number: "1234567890",
                password: "hash",
                Balance: { create: { amount: 4200, locked: 0 } },
            },
        });

        const user = await findOrCreateGoogleUser(prisma, profile);

        expect(user.id).toBe(existing.id);
        expect(user.number).toBe("1234567890");
        expect(await prisma.user.count()).toBe(1);
        expect((await prisma.balance.findUniqueOrThrow({ where: { userId: existing.id } })).amount).toBe(4200);
    });

    test("an existing user with no Balance row gets one", async () => {
        const existing = await prisma.user.create({ data: { email: "ada@example.com", password: "hash" } });

        await findOrCreateGoogleUser(prisma, profile);

        expect(await prisma.balance.count({ where: { userId: existing.id } })).toBe(1);
    });

    test("an unverified Google email is rejected and creates nothing", async () => {
        expect(await code(findOrCreateGoogleUser(prisma, { ...profile, emailVerified: false }))).toBe("UNVERIFIED_EMAIL");
        expect(await prisma.user.count()).toBe(0);
    });

    test("concurrent first sign-ins create one user and one Balance", async () => {
        const users = await Promise.all(Array.from({ length: 5 }, () => findOrCreateGoogleUser(prisma, profile)));

        expect(new Set(users.map((u) => u.id)).size).toBe(1);
        expect(await prisma.user.count()).toBe(1);
        expect(await prisma.balance.count()).toBe(1);
    });
});

describe("setPhoneNumber", () => {
    let googleUser: { id: number };

    beforeEach(async () => {
        googleUser = await findOrCreateGoogleUser(prisma, profile);
    });

    test("sets a valid 10 digit number", async () => {
        const user = await setPhoneNumber(prisma, googleUser.id, "9876543210");

        expect(user.number).toBe("9876543210");
    });

    test("rejects numbers that are not exactly 10 digits", async () => {
        for (const bad of ["12345", "12345678901", "98765abcde", "", "98765 43210"]) {
            expect(await code(setPhoneNumber(prisma, googleUser.id, bad))).toBe("INVALID_PHONE");
        }
        expect((await prisma.user.findUniqueOrThrow({ where: { id: googleUser.id } })).number).toBeNull();
    });

    test("rejects a number already used by another user", async () => {
        await createUser("9876543210", 0);

        expect(await code(setPhoneNumber(prisma, googleUser.id, "9876543210"))).toBe("PHONE_TAKEN");
        expect((await prisma.user.findUniqueOrThrow({ where: { id: googleUser.id } })).number).toBeNull();
    });

    test("two users racing for the same number: exactly one wins", async () => {
        const other = await findOrCreateGoogleUser(prisma, { email: "grace@example.com", name: "Grace", emailVerified: true });

        const outcomes = await Promise.allSettled([
            setPhoneNumber(prisma, googleUser.id, "5555555555"),
            setPhoneNumber(prisma, other.id, "5555555555"),
        ]);

        expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
        const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
        expect((rejected.reason as WalletError).code).toBe("PHONE_TAKEN");
        expect(await prisma.user.count({ where: { number: "5555555555" } })).toBe(1);
    });

    test("an existing number cannot be replaced", async () => {
        await setPhoneNumber(prisma, googleUser.id, "9876543210");

        expect(await code(setPhoneNumber(prisma, googleUser.id, "1111111111"))).toBe("PHONE_ALREADY_SET");
        expect((await prisma.user.findUniqueOrThrow({ where: { id: googleUser.id } })).number).toBe("9876543210");
    });

    test("many users can have no number at the same time", async () => {
        await findOrCreateGoogleUser(prisma, { email: "b@example.com", name: "B", emailVerified: true });
        await findOrCreateGoogleUser(prisma, { email: "c@example.com", name: "C", emailVerified: true });

        expect(await prisma.user.count({ where: { number: null } })).toBe(3);
    });
});
