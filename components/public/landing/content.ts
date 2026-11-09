// Words for the home page, kept apart from the markup so the FAQ structured data reads the same answers.
// Plain, short sentences for any shop owner or cashier. Claims follow the claims check at the end of
// docs/superpowers/notes/2026-11-08-home-page-copy.md.

export const SHOP_TYPES = [
  "Groceries",
  "Cafeterias",
  "Mobile shops",
  "Pharmacies",
  "Perfume shops",
  "Stationery",
  "Bakeries",
  "Gift shops",
  "Electronics",
  "Cosmetics",
] as const;

export const FEATURES = [
  {
    id: "vat",
    page: "vat-invoice",
    title: "VAT receipts, done for you",
    text: "Every receipt shows your TRN and the 5% VAT. Business customers get a full tax invoice.",
    video: "trn",
    alt: "Choosing a business customer with a TRN so the sale prints a full tax invoice.",
  },
  {
    id: "offline",
    page: "offline-pos",
    title: "Works when the internet doesn't",
    text: "Keep selling. Sales wait on the till and send themselves when you're back online.",
    video: "offline",
    alt: "A new sale screen with the status Offline, 1 waiting.",
  },
  {
    id: "cash",
    page: "offline-pos",
    title: "Cash and change in seconds",
    text: "Press F2, type what the customer gave you, and see the change.",
    video: "keyboard",
    alt: "The cash payment window: AED 50.00 received on a total of AED 40.50, change due AED 9.50.",
  },
  {
    id: "close",
    page: "close-day",
    title: "Your drawer, balanced",
    text: "At closing, billo tells you what should be in the drawer and if you're over or short.",
    video: "close-day",
    alt: "Register reconciliation: opening cash, expected cash, counted cash and a variance of AED 0.00.",
  },
  {
    id: "returns",
    page: "returns",
    title: "Easy returns",
    text: "Pick the item, give the refund. Stock goes back and the paperwork is done.",
    video: "returns",
    alt: "Creating a credit note for one Labneh 400g from invoice INV-0142.",
  },
  {
    id: "stock",
    page: "stock",
    title: "Never run out",
    text: "billo warns you when stock is low, before the shelf is empty.",
    video: "lowstock",
    alt: "The inventory list with stock counts and the movement history for Labneh 400g.",
  },
] as const;

export const STEPS = [
  { title: "Add your products", text: "Type them in or upload your Excel list." },
  { title: "Open the till", text: "Count the cash in your drawer and start selling." },
  { title: "Close the day", text: "Count again. billo does the maths and the report." },
] as const;

export const FAQ = [
  {
    q: "Does it work without internet?",
    a: "Yes. If the internet drops, keep selling and printing receipts. Everything sends itself when you're back online, with no double invoices. You need internet to sign up and the first time you sign in on a till.",
  },
  {
    q: "Is it ready for UAE VAT?",
    a: "Yes, billo is built for UAE 5% VAT. Every receipt shows your TRN, the VAT and the total. Walk-in customers get a simplified tax invoice; business customers with a TRN get a full one. Check your setup with your tax adviser.",
  },
  {
    q: "What do I need to start?",
    a: "A computer, laptop or tablet with Chrome or Edge. A barcode scanner, receipt printer and cash drawer are optional. Keep your card machine and just record card sales in billo.",
  },
  {
    q: "Can I bring my product list?",
    a: "Yes. Upload a CSV saved from Excel, match the columns and you're done. You can print barcode labels too.",
  },
  {
    q: "What about e-invoicing in 2027?",
    a: "Small businesses in the UAE are due to start e-invoicing in mid-2027. billo's invoices are already set up for it, and we're getting ready ahead of the deadline. We'll tell you before you need to do anything.",
  },
  {
    q: "Is my data safe?",
    a: "Your data is kept on our servers and on your till, so it keeps working offline. Customer details on the device are encrypted, and finished invoices can't be edited or deleted.",
  },
  {
    q: "Can I cancel?",
    a: "Yes, any time from Settings. No contract, no setup fee.",
  },
] as const;
