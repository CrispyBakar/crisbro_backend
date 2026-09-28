require("dotenv").config({ quiet: true });

const { Worker } = require("bullmq");
const { registerProductSyncScheduler } = require("./scheduler");
const { connection } = require("../../lib/redis");
const { withRunchiseRetry } = require("../../lib/runchiseRetry");
const { generateAllProducts } = require("../../services/product.service");

const worker = new Worker(
  "product-sync",
  async (job) => {
    // Ambil semua produk dari runchise lalu upsert ke tabel Products.
    // Upsert idempoten, jadi retry dari halaman pertama aman.
    const products = await withRunchiseRetry(() => generateAllProducts());

    return { synced: products.length };
  },
  {
    connection,
    concurrency: 1,
  },
);

worker.on("error", (error) => {
  console.error("Product sync worker error:", error);
});

worker.on("failed", (job, error) => {
  console.error(`Product sync job ${job?.id} gagal:`, error);
});

worker.on("completed", (job, result) => {
  console.info(`Product sync completed: ${JSON.stringify(result)}`);
});

registerProductSyncScheduler()
  .then(() => {
    console.log("Product sync scheduler aktif setiap hari jam 02:00.");
  })
  .catch((error) => {
    console.error("Gagal mendaftarkan product sync scheduler:", error);
    process.exit(1);
  });
