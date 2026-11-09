// One entry per feature page. Each page targets one search phrase from
// docs/superpowers/notes/2026-11-08-seo-keyword-research.md, in plain words for shop owners.
// Claims follow the claims check in docs/superpowers/notes/2026-11-08-home-page-copy.md.

export type FeatureSlug = "offline-pos" | "vat-invoice" | "close-day" | "returns" | "stock";

export type FeatureContent = {
  slug: FeatureSlug;
  nav: string;
  short: string; // one line for the cards that link to this page
  title: string; // <title>, under 60 characters
  description: string; // meta description, under 160 characters
  h1: [string, string]; // two authored lines
  lede: string;
  video: string;
  videoAlt: string;
  pointsTitle: string;
  points: { title: string; text: string }[];
  faq: { q: string; a: string }[];
};

export const FEATURE_PAGES: FeatureContent[] = [
  {
    slug: "offline-pos",
    short: "Keep selling when the internet drops.",
    nav: "Offline selling",
    title: "Offline POS for UAE shops | billo",
    description: "billo keeps selling when the internet drops. Sales are saved on the till and sync when you're back online, with no double invoices. Try it free.",
    h1: ["A POS that keeps", "selling offline"],
    lede: "Internet down? Keep serving customers. billo saves every sale on the till and sends it when the connection comes back.",
    video: "offline",
    videoAlt: "A new sale screen with the status Offline, 1 waiting.",
    pointsTitle: "How offline selling works",
    points: [
      { title: "Sell as normal", text: "Scan, take cash or card and print the receipt. Nothing changes for your cashier." },
      { title: "See what's waiting", text: "The status shows how many sales are waiting to send, so you always know where you stand." },
      { title: "Syncs by itself", text: "When the internet is back, waiting sales send on their own. Each one is sent once, so there are no double invoices." },
    ],
    faq: [
      { q: "How long can the till stay offline?", a: "billo is built to ride out internet outages during the day. Sales keep saving on the till and send once you're back online." },
      { q: "Do I need internet to start?", a: "Yes, to sign up and for the first sign-in on a till. After that the till keeps selling through outages." },
      { q: "Can a sale be counted twice?", a: "No. Each sale has its own number and is only sent once, even if the connection drops in the middle." },
    ],
  },
  {
    slug: "vat-invoice",
    short: "Receipts with your TRN and 5% VAT.",
    nav: "VAT invoices",
    title: "VAT invoice software for UAE shops | billo",
    description: "Print UAE VAT receipts with your TRN and 5% VAT on every sale. Simplified tax invoices for walk-ins, full tax invoices for businesses.",
    h1: ["VAT receipts with", "your TRN, done"],
    lede: "Every sale prints a receipt with your TRN and the 5% VAT worked out for you. Business customers get a full tax invoice.",
    video: "trn",
    videoAlt: "Choosing a business customer with a TRN so the sale prints a full tax invoice.",
    pointsTitle: "What every receipt shows",
    points: [
      { title: "Your shop details", text: "Your legal name, address and TRN, printed on every receipt and invoice." },
      { title: "VAT worked out", text: "Prices include VAT. billo splits out the net amount and the 5% VAT on each line." },
      { title: "The right invoice", text: "Walk-ins get a simplified tax invoice. Pick a customer with a TRN and billo prints a full tax invoice." },
    ],
    faq: [
      { q: "What is a simplified tax invoice?", a: "A shorter tax invoice used for walk-in and retail sales. It shows your details, TRN, date, items and VAT. A VAT-registered customer can ask for a full tax invoice instead." },
      { q: "Can I edit an invoice after the sale?", a: "No. Finished invoices are locked. To correct a sale, make a return and billo issues a credit note linked to the original invoice." },
      { q: "Is billo approved by the FTA?", a: "billo is built for UAE 5% VAT invoicing, but the FTA does not approve billing apps. Check your setup with your tax adviser." },
    ],
  },
  {
    slug: "close-day",
    short: "Count the drawer, see over or short.",
    nav: "Closing the day",
    title: "Cash register and end-of-day report | billo",
    description: "Open the till with your float, count the drawer at closing and see if you're over or short. billo does the maths and the daily report.",
    h1: ["Close the day with", "a balanced drawer"],
    lede: "Count the drawer and billo tells you what should be there, what's over or short, and gives you the day's report.",
    video: "close-day",
    videoAlt: "Register reconciliation: opening cash, expected cash, counted cash and a variance of AED 0.00.",
    pointsTitle: "How closing works",
    points: [
      { title: "Open with your float", text: "Count the cash in the drawer in the morning and open the till." },
      { title: "Count at closing", text: "billo works out what should be in the drawer and keeps card sales apart from cash." },
      { title: "See the difference", text: "Over or short shows at once. Print the day's report or send the CSV to your accountant." },
    ],
    faq: [
      { q: "What's on the daily report?", a: "Number of sales, total sales, VAT, cash and card totals, refunds and the drawer count." },
      { q: "Does the business day follow Dubai time?", a: "Yes. Dates follow Dubai time, whatever the computer's clock is set to." },
      { q: "Can my accountant use the report?", a: "Yes. Export it as CSV and open it in Excel or Google Sheets." },
    ],
  },
  {
    slug: "returns",
    short: "Credit notes and refunds in a few taps.",
    nav: "Returns",
    title: "Returns and credit notes for UAE shops | billo",
    description: "Take a return in a few taps. billo issues a credit note linked to the original invoice, puts the stock back and records the refund.",
    h1: ["Returns without", "the paperwork"],
    lede: "Find the sale, pick what's coming back and give the refund. billo issues the credit note and puts the stock back.",
    video: "returns",
    videoAlt: "Creating a credit note for one Labneh 400g from invoice INV-0142.",
    pointsTitle: "How returns work",
    points: [
      { title: "Find the sale", text: "Open the invoice from the sales list or search by number." },
      { title: "Pick the items", text: "Choose how many of each item come back. billo won't let you return more than was sold." },
      { title: "Done properly", text: "A credit note is issued and linked to the invoice, stock goes back, and the refund is recorded." },
    ],
    faq: [
      { q: "Does the original invoice change?", a: "No. The invoice stays as it was. The return is a separate credit note that points to it." },
      { q: "Can I return part of a sale?", a: "Yes. Return one item or a few, and billo tracks what is left to return." },
      { q: "Does the refund show in the day's report?", a: "Yes. Refunds appear in the daily report and the drawer count." },
    ],
  },
  {
    slug: "stock",
    short: "Low-stock warnings before you run out.",
    nav: "Stock",
    title: "Stock and low-stock alerts for small shops | billo",
    description: "Stock goes down with every sale and back up with every return. billo warns you when a product is running low, before the shelf is empty.",
    h1: ["Know before you", "run out of stock"],
    lede: "Stock updates with every sale and return. Set a low level for each product and billo warns you in time.",
    video: "lowstock",
    videoAlt: "The inventory list with stock counts and the movement history for Labneh 400g.",
    pointsTitle: "How stock works",
    points: [
      { title: "Always up to date", text: "Every sale takes stock out and every return puts it back, on its own." },
      { title: "Low-stock warnings", text: "Set a low level per product. It shows on the dashboard before you run out." },
      { title: "Every change explained", text: "Deliveries and corrections need a reason, and the history is kept for each product." },
    ],
    faq: [
      { q: "Can I import my products and stock?", a: "Yes. Upload a CSV saved from Excel and match the columns." },
      { q: "Can stock go below zero?", a: "No. billo stops a sale that would take stock below zero." },
      { q: "Can I print barcode labels?", a: "Yes. Print labels for your products from your product list." },
    ],
  },
];

export function getFeature(slug: FeatureSlug): FeatureContent {
  const page = FEATURE_PAGES.find((item) => item.slug === slug);
  if (!page) throw new Error(`Unknown feature page: ${slug}`);
  return page;
}
