require("dotenv").config({ quiet: true });

const { Worker } = require("bullmq");
const {
  registerCustomerBirthdayScheduler,
  CUSTOMER_BIRTHDAY_PATTERN,
  CUSTOMER_BIRTHDAY_TZ,
} = require("./scheduler");
const { connection } = require("../../lib/redis");
const { sendBirthdayGreetings } = require("../../services/birthday.service");

const worker = new Worker(
  "customer-birthday",
  // Aman di-retry: tiap device hanya diberi ucapan sekali per hari
  // (penanda di Redis), jadi job bisa dijalankan ulang tanpa spam.
  () => sendBirthdayGreetings(),
  {
    connection,
    concurrency: 1,
  },
);

worker.on("error", (error) => {
  console.error("Customer birthday worker error:", error);
});

worker.on("failed", (job, error) => {
  console.error(`Customer birthday job ${job?.id} gagal:`, error);
});

worker.on("completed", (job, result) => {
  console.info(`[birthday] selesai: ${JSON.stringify(result)}`);
});

registerCustomerBirthdayScheduler()
  .then(() => {
    console.log(
      `Customer birthday scheduler aktif dengan pattern ${CUSTOMER_BIRTHDAY_PATTERN} (${CUSTOMER_BIRTHDAY_TZ}).`,
    );
  })
  .catch((error) => {
    console.error("Gagal mendaftarkan customer birthday scheduler:", error);
    process.exit(1);
  });
