import { Card } from "@repo/ui/card"

export const P2pTransfers = ({ transfers }: {
    transfers: { id: number; direction: "sent" | "received"; counterpartyNumber: string; amount: number; time: Date }[]
}) => {
    if (!transfers.length) {
        return <Card title="Your Transfers">
            <div className="text-center pb-8 pt-8">No transfers yet</div>
        </Card>
    }
    return <Card title="Your Transfers">
        <div className="pt-2">
            {transfers.map(t => <div key={t.id} className="flex justify-between py-1">
                <div>
                    <div className="text-sm">
                        {t.direction === "sent" ? "Sent to" : "Received from"} {t.counterpartyNumber}
                    </div>
                    <div className="text-slate-600 text-xs">{t.time.toDateString()}</div>
                </div>
                <div className={`flex flex-col justify-center ${t.direction === "sent" ? "text-red-600" : "text-green-600"}`}>
                    {t.direction === "sent" ? "-" : "+"} Rs {t.amount / 100}
                </div>
            </div>)}
        </div>
    </Card>
}
