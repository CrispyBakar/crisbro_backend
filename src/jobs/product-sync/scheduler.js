const { productQueue } = require("../../lib/queue");

async function registerProductSyncScheduler() {
  // Jam 02:00 (zona waktu server), setelah job customer-point-daily jam 01:00
  return productQueue.upsertJobScheduler(
    "product-sync-daily",
    { pattern: "0 2 * * *" },
    {
      name: "product-sync",
      data: {},
      opts: {
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    },
  );
}

module.exports = { registerProductSyncScheduler };
