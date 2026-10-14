const dotenv = require("dotenv").config();

const { Worker } = require("bullmq");
const { registerPushBroadcastScheduler } = require("./scheduler");
const { connection } = require("../../lib/redis");
const { processPendingBroadcasts } = require("../../services/push.service");

const worker = new Worker("push-broadcast", () => processPendingBroadcasts(), {
  connection,
  concurrency: 1,
});

worker.on("error", (error) => {
  console.error("Push broadcast worker error:", error);
});

worker.on("completed", (job, result) => {
  if (result?.processed?.length) {
    console.info(
      `[push] broadcast terkirim: ${JSON.stringify(result?.processed)}`,
    );
  }
});

worker.on("failed", (job, error) => {
  console.error(`Push broadcast job ${job?.id} gagal:`, error);
});

registerPushBroadcastScheduler()
  .then(() =>
    console.log("Push broadcast worker aktif, cek antrean tiap 30 detik."),
  )
  .catch((error) => {
    console.error("Gagal mendaftarkan push broadcast scheduler:", error);
    process.exit(1);
  });
