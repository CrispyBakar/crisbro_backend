const { pushQueue } = require("../../lib/queue");

// Worker ini mengecek baris pending setiap 30 dtik lalu mengirimnya
async function registerPushBroadcastScheduler() {
  return pushQueue.upsertJobScheduler(
    "push-broadcast-poll",
    { every: 30_000 },
    {
      name: "push-broadcast",
      data: {},
      opts: { removeOnComplete: 100, removeOnFail: 100 },
    },
  );
}

module.exports = { registerPushBroadcastScheduler };
