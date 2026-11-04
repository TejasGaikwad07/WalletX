import prisma from "@repo/db/client";
import { getServerSession } from "next-auth";
import { Card } from "@repo/ui/card";
import { authOptions } from "../../lib/auth";
import { PhoneForm } from "../../../components/PhoneForm";

async function getUser() {
    const session = await getServerSession(authOptions);
    const userId = Number(session?.user?.id);
    if (!userId) return null;
    return prisma.user.findUnique({ where: { id: userId } });
}

export default async function() {
    const user = await getUser();

    return <div className="w-screen">
        <div className="text-4xl text-[#6a51a6] pt-8 mb-8 font-bold">
            Profile
        </div>
        <div className="p-4 max-w-lg">
            {!user ? <Card title="Profile"><div className="text-center py-4">Not signed in</div></Card>
                : user.number ? <Card title="Profile">
                    <div className="pt-2 text-sm">Name: {user.name ?? "-"}</div>
                    <div className="pt-2 text-sm">Email: {user.email ?? "-"}</div>
                    <div className="pt-2 text-sm">Phone number: {user.number}</div>
                </Card>
                : <>
                    <div className="pb-4 text-sm text-slate-600">
                        Signed in as {user.email}. Add a phone number so other people can send you money.
                    </div>
                    <PhoneForm />
                </>}
        </div>
    </div>
}
