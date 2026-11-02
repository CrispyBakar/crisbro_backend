const { productQueue } = require("../../lib/queue");

async function registerProductSyncScheduler() {
  // 02:00 WIB (19:00 UTC hari sebelumnya), setelah customer-point-daily.
  return productQueue.upsertJobScheduler(
    "product-sync-daily",
    { pattern: "0 19 * * *", tz: "UTC" },
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
