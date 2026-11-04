"use client"
import { useFormState, useFormStatus } from "react-dom";
import { Card } from "@repo/ui/card";
import { savePhone, ProfileActionState } from "../app/lib/actions/profile";

function SubmitButton() {
    const { pending } = useFormStatus();
    return <button type="submit" disabled={pending} className="text-white bg-gray-800 hover:bg-gray-900 disabled:opacity-50 font-medium rounded-lg text-sm px-5 py-2.5">
        {pending ? "Saving..." : "Save"}
    </button>
}

export const PhoneForm = () => {
    const [state, action] = useFormState<ProfileActionState | null, FormData>(savePhone, null);

    return <Card title="Add your phone number">
        <form action={action} className="w-full">
            <label className="block pt-2 mb-2 text-sm font-medium text-gray-900">Phone number (10 digits)</label>
            <input name="phone" type="text" inputMode="numeric" maxLength={10} placeholder="9876543210" required
                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg block w-full p-2.5" />
            <div className="flex justify-center pt-4">
                <SubmitButton />
            </div>
            {state && <div className={`text-center text-sm pt-2 ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</div>}
        </form>
    </Card>
}
