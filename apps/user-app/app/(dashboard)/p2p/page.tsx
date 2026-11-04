import prisma from "@repo/db/client";
import { getServerSession } from "next-auth";
import { authOptions } from "../../lib/auth";
import { P2pForm } from "../../../components/P2pForm";
import { P2pTransfers } from "../../../components/P2pTransfers";

async function getTransfers() {
    const session = await getServerSession(authOptions);
    const userId = Number(session?.user?.id);
    if (!userId) return [];
    const rows = await prisma.p2pTransfer.findMany({
        where: { OR: [{ fromUserId: userId }, { toUserId: userId }] },
        include: { fromUser: true, toUser: true },
        orderBy: { createdAt: "desc" },
    });
    return rows.map(t => {
        const sent = t.fromUserId === userId;
        return {
            id: t.id,
            direction: sent ? "sent" as const : "received" as const,
            counterpartyNumber: sent ? t.toUser.number : t.fromUser.number,
            amount: t.amount,
            time: t.createdAt,
        };
    });
}

export default async function() {
    const transfers = await getTransfers();

    return <div className="w-screen">
        <div className="text-4xl text-[#6a51a6] pt-8 mb-8 font-bold">
            P2P Transfer
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 p-4">
            <div>
                <P2pForm />
            </div>
            <div>
                <P2pTransfers transfers={transfers} />
            </div>
        </div>
    </div>
}
