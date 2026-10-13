function dubaiParts(date: Date, year: "2-digit" | "numeric") {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", year, month: "2-digit", day: "2-digit" }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function dubaiDateCode(date: Date): string {
  const { year, month, day } = dubaiParts(date, "2-digit");
  return `${year}${month}${day}`;
}

export function dubaiSupplyDate(date: Date): string {
  const { year, month, day } = dubaiParts(date, "numeric");
  return `${year}-${month}-${day}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nextInSeries(seriesPrefix: string, existing: string[]): string {
  const pattern = new RegExp(`^${escapeRegExp(seriesPrefix)}(\\d{4,})$`);
  const used = existing.map((value) => value.match(pattern)).filter((match): match is RegExpMatchArray => Boolean(match)).map((match) => Number(match[1]));
  return `${seriesPrefix}${String(Math.max(0, ...used) + 1).padStart(4, "0")}`;
}

function assertTill(tillNumber: number) {
  if (!Number.isInteger(tillNumber) || tillNumber < 1) throw new RangeError("Till number must be a positive integer.");
}

export function nextInvoiceNumber(prefix: string, tillNumber: number, date: Date, existing: string[]): string {
  assertTill(tillNumber);
  return nextInSeries(`${prefix}-${tillNumber}-${dubaiDateCode(date)}-`, existing);
}

export function nextCreditNoteNumber(tillNumber: number, date: Date, existing: string[]): string {
  assertTill(tillNumber);
  return nextInSeries(`CN-${tillNumber}-${dubaiDateCode(date)}-`, existing);
}
