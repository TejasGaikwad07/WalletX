"use client"
import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Card } from "@repo/ui/card";
import { sendP2p, P2pActionState } from "../app/lib/actions/p2p";

function SubmitButton() {
    const { pending } = useFormStatus();
    return <button type="submit" disabled={pending} className="text-white bg-gray-800 hover:bg-gray-900 disabled:opacity-50 font-medium rounded-lg text-sm px-5 py-2.5">
        {pending ? "Sending..." : "Send"}
    </button>
}

export const P2pForm = () => {
    // One key per attempt: reused if the user retries after an error, replaced after a success.
    const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
    const [state, action] = useFormState<P2pActionState | null, FormData>(sendP2p, null);
    const formRef = useRef<HTMLFormElement>(null);

    useEffect(() => {
        if (state?.ok) {
            formRef.current?.reset();
            setIdempotencyKey(crypto.randomUUID());
        }
    }, [state]);

    return <Card title="Send Money">
        <form ref={formRef} action={action} className="w-full">
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            <label className="block pt-2 mb-2 text-sm font-medium text-gray-900">Phone number</label>
            <input name="phone" type="text" inputMode="numeric" placeholder="2222222222" required
                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg block w-full p-2.5" />
            <label className="block pt-2 mb-2 text-sm font-medium text-gray-900">Amount (INR)</label>
            <input name="amount" type="number" step="0.01" min="0.01" placeholder="100" required
                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg block w-full p-2.5" />
            <div className="flex justify-center pt-4">
                <SubmitButton />
            </div>
            {state && <div className={`text-center text-sm pt-2 ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</div>}
        </form>
    </Card>
}
