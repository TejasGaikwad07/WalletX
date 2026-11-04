"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import prisma from "@repo/db/client";
import { setPhoneNumber, WalletError } from "@repo/wallet";
import { authOptions } from "../auth";

export type ProfileActionState = { ok: boolean; message: string };

export async function savePhone(_prev: ProfileActionState | null, formData: FormData): Promise<ProfileActionState> {
    const session = await getServerSession(authOptions);
    const userId = Number(session?.user?.id);
    if (!userId) {
        return { ok: false, message: "Not signed in" };
    }

    try {
        await setPhoneNumber(prisma, userId, String(formData.get("phone") ?? ""));
        revalidatePath("/profile");
        revalidatePath("/p2p");
        return { ok: true, message: "Phone number saved" };
    } catch (e) {
        if (e instanceof WalletError) {
            return { ok: false, message: e.message };
        }
        console.error(e);
        return { ok: false, message: "Something went wrong" };
    }
}
