// Reset BullMQ queue customer-sync / customer-point-daily / product-sync untuk testing worker.
//
// Pemakaian:
//   node scripts/reset-queue.js                 -> kosongkan semua queue
//   node scripts/reset-queue.js --run           -> kosongkan + langsung enqueue 1 job customer-sync
//   node scripts/reset-queue.js --run-daily     -> kosongkan + langsung enqueue 1 job customer-point-daily
//   node scripts/reset-queue.js --run-product   -> kosongkan + langsung enqueue 1 job product-sync
//   node scripts/reset-queue.js --checkpoint    -> juga hapus checkpoint sale_transactions (sync ulang dari awal)
require("dotenv").config({ quiet: true });

const { syncQueue, pointQueue, productQueue } = require("../src/lib/queue");
const { connection } = require("../src/lib/redis");
const prisma = require("../src/lib/prisma");

const args = process.argv.slice(2);

async function main() {
  for (const queue of [syncQueue, pointQueue, productQueue]) {
    // obliterate menghapus semua job (waiting, delayed, active, completed, failed)
    // termasuk job scheduler; worker akan mendaftarkan scheduler lagi saat start.
    await queue.obliterate({ force: true });
    console.log(`Queue "${queue.name}" dikosongkan.`);
  }

  if (args.includes("--checkpoint")) {
    const { count } = await prisma.syncCheckpoints.deleteMany({
      where: { job_category: "sale_transactions" },
    });
    console.log(`${count} checkpoint sale_transactions dihapus.`);
  }

  if (args.includes("--run")) {
    const job = await syncQueue.add("customer-sync", {});
    console.log(`Job customer-sync ${job.id} ditambahkan.`);
  }

  if (args.includes("--run-daily")) {
    const job = await pointQueue.add("customer-point-daily", {});
    console.log(`Job customer-point-daily ${job.id} ditambahkan.`);
  }

  if (args.includes("--run-product")) {
    const job = await productQueue.add("product-sync", {});
    console.log(`Job product-sync ${job.id} ditambahkan.`);
  }
}

main()
  .catch((error) => {
    console.error("Gagal reset queue:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all([
      syncQueue.close(),
      pointQueue.close(),
      productQueue.close(),
    ]);
    await prisma.$disconnect();
    connection.disconnect();
  });
