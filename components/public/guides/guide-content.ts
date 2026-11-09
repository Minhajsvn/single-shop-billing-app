// Guides for UAE shop owners. Confirmed facts only, each tied to a source listed on the page.
// Where sources disagree (the simplified tax invoice change, the large-business deadline) the page says so
// and points to the adviser instead of picking a side. Checked 2026-11-08; re-check before relying on dates.

export type GuideSlug = "uae-e-invoicing-small-business" | "uae-tax-invoice";

export type GuideBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; head: [string, string, string]; rows: [string, string, string][] };

export type Guide = {
  slug: GuideSlug;
  nav: string;
  title: string;
  description: string;
  h1: [string, string];
  lede: string;
  checked: string; // ISO date the facts were last checked
  figure: { video: string; caption: string };
  sections: { heading: string; blocks: GuideBlock[] }[];
  faq: { q: string; a: string }[];
  sources: { label: string; url: string }[];
};

export const GUIDES: Guide[] = [
  {
    slug: "uae-e-invoicing-small-business",
    nav: "E-invoicing for small businesses",
    title: "UAE e-invoicing for small businesses: 2027 dates | billo",
    description: "When UAE e-invoicing starts for businesses under AED 50 million, what an Accredited Service Provider is, and what a small shop can do now.",
    h1: ["UAE e-invoicing:", "what small shops need"],
    lede: "The UAE is moving business invoices to a national e-invoicing system. Here are the confirmed dates for smaller businesses, in plain words.",
    checked: "2026-11-08",
    figure: { video: "trn", caption: "In billo, picking a business customer with a TRN prints a full tax invoice." },
    sections: [
      {
        heading: "The short version",
        blocks: [
          { kind: "list", items: [
            "If your business makes less than AED 50 million a year, you must appoint an Accredited Service Provider by 31 March 2027.",
            "E-invoicing becomes mandatory for you on 1 July 2027.",
            "Sales to ordinary customers (business to consumer) are outside the e-invoicing system for now.",
          ] },
        ] },
      {
        heading: "Where the rules come from",
        blocks: [
          { kind: "p", text: "The Ministry of Finance issued Ministerial Decision No. 243 of 2025 on the Electronic Invoicing System and Ministerial Decision No. 244 of 2025 on its implementation, on 29 September 2025. Decision 244 sets the dates below." },
        ] },
      {
        heading: "Key dates",
        blocks: [
          { kind: "table", head: ["Who", "Appoint a provider by", "E-invoicing starts"], rows: [
            ["Pilot (voluntary)", "—", "1 July 2026"],
            ["Revenue under AED 50 million", "31 March 2027", "1 July 2027"],
            ["Revenue of AED 50 million or more", "31 July 2026 in the original decision (see note)", "1 January 2027"],
            ["Government entities", "31 March 2027", "1 October 2027"],
          ] },
          { kind: "p", text: "Note: some sources report that the appointment deadline for larger businesses was later extended. That does not change the dates for smaller businesses, but check the Ministry of Finance website for the latest decision." },
        ] },
      {
        heading: "What is an Accredited Service Provider?",
        blocks: [
          { kind: "p", text: "An Accredited Service Provider (ASP) is a company approved to send and receive e-invoices for you. Your invoice goes from your system to your ASP, which sends it in the national format to your customer's provider and reports it to the tax authority. Each business appoints one ASP." },
        ] },
      {
        heading: "What you can do now",
        blocks: [
          { kind: "list", items: [
            "Check which group you are in, using your annual revenue.",
            "Keep your business customers' details complete, including their TRN.",
            "Make sure your shop's own details and TRN are correct on every invoice.",
            "Talk to your accountant or tax adviser about choosing an ASP before 31 March 2027.",
          ] },
          { kind: "p", text: "billo's invoice data is already structured for e-invoicing, and we are preparing e-invoicing support ahead of the July 2027 date. billo is not an Accredited Service Provider." },
        ] },
    ],
    faq: [
      { q: "When does e-invoicing start for a small shop in the UAE?", a: "For businesses with revenue under AED 50 million, e-invoicing is mandatory from 1 July 2027, and an Accredited Service Provider must be appointed by 31 March 2027." },
      { q: "Do receipts for walk-in customers have to be e-invoices?", a: "Sales to ordinary consumers (business to consumer) are outside the e-invoicing system for now. Ask your tax adviser how this applies to your shop." },
      { q: "Is billo an Accredited Service Provider?", a: "No. billo is a till and billing app. You will appoint an ASP separately, and we are preparing billo to work with e-invoicing ahead of July 2027." },
    ],
    sources: [
      { label: "Ministry of Finance: Ministerial Decision No. 244 of 2025 (PDF)", url: "https://mof.gov.ae/wp-content/uploads/2025/09/Ministerial-Decision-No.-244-of-2025-on-the-Implementation-of-the-Electronic-Invoicing-System.pdf" },
      { label: "EY: UAE Ministry of Finance publishes ministerial decisions on e-invoicing", url: "https://taxnews.ey.com/news/2025-1964-uae-ministry-of-finance-publishes-ministerial-decisions-on-e-invoicing" },
      { label: "KPMG: Implementation of the electronic invoicing system in the UAE", url: "https://kpmg.com/ae/en/insights/tax-insights/implementation-of-the-electronic-invoicing-system-in-the-uae.html" },
    ],
  },
  {
    slug: "uae-tax-invoice",
    nav: "Tax invoices: what changed",
    title: "UAE tax invoices: what changed in 2025 | billo",
    description: "Cabinet Decision No. 100 of 2025 changed the UAE VAT rules on tax invoices and credit notes ahead of e-invoicing. What it covers and what to ask your adviser.",
    h1: ["UAE tax invoices:", "what changed in 2025"],
    lede: "In 2025 the UAE changed its VAT rules on tax invoices and credit notes to prepare for e-invoicing. Here is what is confirmed, and what to check with your adviser.",
    checked: "2026-11-08",
    figure: { video: "returns", caption: "In billo, a return issues a credit note linked to the original invoice." },
    sections: [
      {
        heading: "The short version",
        blocks: [
          { kind: "list", items: [
            "UAE VAT is 5%. A VAT-registered shop must show its TRN on its tax invoices.",
            "Cabinet Decision No. 100 of 2025 amended the VAT Executive Regulations, including Article 59 (tax invoices) and Article 60 (credit notes).",
            "Tax firms read the change as ending simplified tax invoices for businesses once e-invoicing applies to them. They disagree on exactly when.",
            "Before you change how you invoice, confirm the position with your tax adviser.",
          ] },
        ] },
      {
        heading: "Simplified tax invoices",
        blocks: [
          { kind: "p", text: "A simplified tax invoice is the shorter invoice that shops have used for walk-in customers. Under the rules before the change, it could be used when the customer is not VAT-registered, or when a registered customer's purchase was AED 10,000 or less." },
          { kind: "p", text: "Several tax firms say the 2025 amendment removes simplified tax invoices for businesses within the e-invoicing system. Some say the change applies from 29 September 2025; others tie it to each business's e-invoicing start date. The Federal Tax Authority's published text should be your reference, together with your adviser's reading." },
        ] },
      {
        heading: "Credit notes",
        blocks: [
          { kind: "p", text: "Tax firms report that a tax credit note no longer has to show the original value, the corrected value and the difference: the amount and the VAT on it are enough. Credit notes are still needed when you refund a sale." },
        ] },
      {
        heading: "What you can do now",
        blocks: [
          { kind: "list", items: [
            "Ask your tax adviser whether you should issue full tax invoices for every sale, and from when.",
            "Keep your business customers' details complete, including their TRN.",
            "Check that your shop's legal name, address and TRN are correct on your invoices.",
            "Note your e-invoicing date: 1 July 2027 for businesses under AED 50 million.",
          ] },
          { kind: "p", text: "billo prints your TRN and the 5% VAT on every invoice, and prints a full tax invoice whenever you pick a customer with a TRN. We are following the change and will update billo's invoices when the position for small shops is clear." },
        ] },
    ],
    faq: [
      { q: "Can I still give walk-in customers a simplified tax invoice?", a: "It depends on whether and when the 2025 amendment applies to your business. Tax firms disagree on the timing, so ask your tax adviser before you change anything." },
      { q: "What decision changed the tax invoice rules?", a: "Cabinet Decision No. 100 of 2025, which amended the VAT Executive Regulations, including Articles 59 and 60." },
      { q: "What should every tax invoice show?", a: "Your shop's details and TRN, the date, what was sold and the VAT. The exact list of required details is set by the VAT Executive Regulations, so check the current text with your adviser." },
    ],
    sources: [
      { label: "Federal Tax Authority: VAT Executive Regulation, consolidated text (PDF)", url: "https://tax.gov.ae/Datafolder/Files/Legislation/Executive-Regulation-of-Federal-Decree-Law-No-08-of-2017-Publish-18-09-2025.pdf" },
      { label: "Grant Thornton UAE: Executive Regulation amendments", url: "https://www.grantthornton.ae/insights/articles2/tax-alert-executive-regulation-amendments/" },
      { label: "Crowe UAE: What is the recent amendment to UAE VAT Executive Regulation?", url: "https://www.crowe.com/ae/news/what-is-the-recent-amendment-to-uae-vat" },
      { label: "Alvarez & Marsal: UAE VAT law amendments for e-invoicing", url: "https://www.alvarezandmarsal.com/thought-leadership/middle-east-tax-alert-uae-latest-vat-law-amendments-for-the-upcoming-uae-e-invoicing-implementation" },
    ],
  },
];

export function getGuide(slug: GuideSlug): Guide {
  const guide = GUIDES.find((item) => item.slug === slug);
  if (!guide) throw new Error(`Unknown guide: ${slug}`);
  return guide;
}
