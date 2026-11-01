// Browser helper for Razorpay Checkout (the payment window). Only used from client components.
const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

type RazorpayOptions = {
  key: string;
  subscription_id: string;
  name: string;
  description: string;
  handler: () => void;
  modal: { ondismiss: () => void };
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

let loading: Promise<void> | null = null;

/** Injects Razorpay's checkout script once and resolves when it has loaded. */
export function loadRazorpayCheckout(): Promise<void> {
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      loading = null;
      reject(new Error("Razorpay Checkout could not be loaded."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Opens the payment window for a subscription; the script must be loaded first. */
export function openRazorpayCheckout(opts: { keyId: string; subscriptionId: string; onPaid: () => void; onDismiss: () => void }): void {
  if (!window.Razorpay) throw new Error("Razorpay Checkout is not loaded.");
  new window.Razorpay({
    key: opts.keyId,
    subscription_id: opts.subscriptionId,
    name: "billo",
    description: "Starter plan",
    handler: opts.onPaid,
    modal: { ondismiss: opts.onDismiss },
  }).open();
}
