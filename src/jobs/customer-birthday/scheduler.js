const { birthdayQueue } = require("../../lib/queue");

// Sekali sehari jam 08:00 WIB, jam yang wajar untuk menerima ucapan.
const CUSTOMER_BIRTHDAY_PATTERN = "0 9 * * *";
const CUSTOMER_BIRTHDAY_TZ = "Asia/Jakarta";

async function registerCustomerBirthdayScheduler() {
  // tz eksplisit karena server worker belum tentu di UTC+7,
  // sedangkan "hari ulang tahun" mengikuti kalender WIB.
  return birthdayQueue.upsertJobScheduler(
    "customer-birthday-daily",
    { pattern: CUSTOMER_BIRTHDAY_PATTERN, tz: CUSTOMER_BIRTHDAY_TZ },
    {
      name: "customer-birthday",
      data: {},
      opts: {
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    },
  );
}

module.exports = {
  registerCustomerBirthdayScheduler,
  CUSTOMER_BIRTHDAY_PATTERN,
  CUSTOMER_BIRTHDAY_TZ,
};
