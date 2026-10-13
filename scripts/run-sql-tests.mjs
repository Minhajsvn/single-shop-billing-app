import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.SUPABASE_TEST_DB_URL;
if (!url) {
  console.error("SUPABASE_TEST_DB_URL is not set. Use a NON-PRODUCTION Supabase project.");
  process.exit(2);
}

const directory = "supabase/tests";
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(directory).filter((name) => name.endsWith(".sql")).sort().map((name) => join(directory, name));
const sql = postgres(url, { max: 1, onnotice: () => {} });
let failed = 0;

for (const file of files) {
  try {
    await sql.unsafe(readFileSync(file, "utf8"));
    console.log(`PASS ${file}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${file}\n  ${error.message}${error.detail ? `\n  detail: ${error.detail}` : ""}`);
    await sql.unsafe("rollback").catch(() => {});
  }
}

await sql.end();
process.exit(failed ? 1 : 0);
