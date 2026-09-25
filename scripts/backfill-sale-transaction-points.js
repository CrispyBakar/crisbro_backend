// Backfill sekali jalan untuk kolom poin SaleTransaction (point_from_transaction, total_point,
// earned_point, redeemed_point, available_point) yang tersimpan NULL karena
// mapping lama membaca dari level atas transaksi, bukan dari `metadata`.
//   node scripts/backfill-sale-transaction-points.js --dry-run     # hitung kandidat saja
//   node scripts/backfill-sale-transaction-points.js --limit=20    # uji coba sebagian
//   node scripts/backfill-sale-transaction-points.js               # jalankan semua
require("dotenv").config();
const prisma = require("../src/lib/prisma");
const {
  backfillSaleTransactionPoints,
} = require("../src/services/saleTransaction.service");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

  const summary = await backfillSaleTransactionPoints({ dryRun, limit });
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
