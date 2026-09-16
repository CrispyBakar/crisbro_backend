const { syncQueue, pointQueue } = require("../../lib/queue");

async function registerCustomerSyncScheduler() {
  return syncQueue.upsertJobScheduler(
    "customer-sync-every-minute",
    { every: 5 * 60_000 },
    {
      name: "customer-sync",
      data: {},
      opts: {
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    },
  );
}

async function registeredCustomerSyncPointHistory() {
  // Hapus scheduler lama yang dulu salah terdaftar di queue customer-sync
  await syncQueue.removeJobScheduler("customer-sync-daily");

  return pointQueue.upsertJobScheduler(
    "customer-sync-daily",
    { pattern: "0 1 * * *" },
    {
      name: "customer-point-daily",
      data: {},
      opts: {
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    },
  );
}

module.exports = {
  registerCustomerSyncScheduler,
  registeredCustomerSyncPointHistory,
};
