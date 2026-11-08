"use client";

import { Key } from "@/components/icons";
import { useState } from "react";
import { refreshSnapshot } from "@/lib/demo-store";
import { toast } from "@/lib/ui/toast-store";
import { SetPinDialog } from "./set-pin-dialog";

/** "Your PIN": any signed-in member sets or changes their own till PIN (spec 2A §6). */
export function YourPinCard({ pinSet }: { pinSet?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel">
      <div className="panel-header">
        <div><div className="panel-title">Your PIN</div><div className="panel-subtitle">The 4-digit PIN you use on a shared till</div></div>
        <button className="button" type="button" onClick={() => setOpen(true)}><Key size={15} weight="bold" />{pinSet ? "Change PIN" : "Set PIN"}</button>
      </div>
      {open ? <SetPinDialog title="Your PIN" url="/api/v1/staff/me/pin" onCancel={() => setOpen(false)} onDone={() => { setOpen(false); toast("PIN saved"); void refreshSnapshot(); }} /> : null}
    </section>
  );
}
