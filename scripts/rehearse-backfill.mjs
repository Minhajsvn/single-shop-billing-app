// Rehearses the Stage 1A migrations against a database that already holds shops, as production does.
// LOCAL ONLY: resets the local Supabase database twice. Usage: npm run test:rehearsal
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import postgres from "postgres";

const PRE_STAGE_1A_VERSION = "202609140009";
const SEED = "supabase/tests/rehearsal/seed_existing_shops.sql";
const ASSERTIONS = "supabase/tests/rehearsal/assert_after_migrations.sql";

const url = process.env.SUPABASE_TEST_DB_URL;
if (!url) {
  console.error("SUPABASE_TEST_DB_URL is not set.");
  process.exit(2);
}
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
  console.error(`Refusing to rehearse against non-local host ${host}. This script resets the database.`);
  process.exit(2);
}

function supabase(...args) {
  const command = `supabase ${args.join(" ")}`;
  console.log(`\n$ ${command}`);
  // Arguments are fixed literals; a shell is needed on Windows to resolve the supabase shim.
  const result = spawnSync(command, { stdio: "inherit", shell: true });
  if (result.status !== 0) {
    throw new Error(`supabase ${args.join(" ")} exited with ${result.status ?? result.error?.message}`);
  }
}

async function runSqlFile(file) {
  console.log(`\n$ psql < ${file}`);
  let lastError;
  // The database restarts after a reset; retry the connection briefly.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const sql = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 5 });
    try {
      await sql`select 1`;
    } catch (error) {
      lastError = error;
      await sql.end({ timeout: 1 }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 2000));
      continue;
    }
    try {
      await sql.unsafe(readFileSync(file, "utf8"));
      console.log(`ok ${file}`);
      return;
    } catch (error) {
      await sql.unsafe("rollback").catch(() => {});
      throw new Error(`${file}: ${error.message}${error.detail ? ` (detail: ${error.detail})` : ""}`);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
  throw new Error(`could not connect to ${host}: ${lastError?.message}`);
}

let failure;
try {
  supabase("db", "reset", "--local", "--version", PRE_STAGE_1A_VERSION);
  await runSqlFile(SEED);
  supabase("migration", "up", "--local");
  await runSqlFile(ASSERTIONS);
} catch (error) {
  failure = error;
}

try {
  supabase("db", "reset", "--local");
} catch (error) {
  failure ??= error;
}

if (failure) {
  console.error(`\nFAIL backfill rehearsal\n  ${failure.message}`);
  process.exit(1);
}
console.log("\nPASS backfill rehearsal");
