// Terminate stale sessions holding Postgres advisory locks (Prisma migrate lock).
// Use when `prisma migrate dev` fails with P1002 (advisory lock timeout).
//   node scripts/db-unlock.mjs           # list lock holders only
//   node scripts/db-unlock.mjs --kill    # also terminate them
import pg from "pg";
import "dotenv/config";

const url = process.env.DIRECT_URL;
if (!url) {
  console.error("Error: DIRECT_URL not set in .env");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows } = await client.query(`
  SELECT l.pid,
         l.mode,
         a.state,
         a.backend_start,
         a.state_change,
         left(a.query, 60) AS query
  FROM pg_locks l
  LEFT JOIN pg_stat_activity a ON a.pid = l.pid
  WHERE l.locktype = 'advisory'
  ORDER BY a.backend_start NULLS LAST;
`);

if (rows.length === 0) {
  console.log("No advisory locks held right now.");
} else {
  console.table(rows);

  if (process.argv.includes("--kill")) {
    for (const row of rows) {
      if (row.pid != null) {
        await client.query("SELECT pg_terminate_backend($1)", [row.pid]);
        console.log(`Terminated pid ${row.pid}`);
      }
    }
  } else {
    console.log("Run with --kill to terminate these sessions.");
  }
}

await client.end();
