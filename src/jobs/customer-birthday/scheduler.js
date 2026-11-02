const { birthdayQueue } = require("../../lib/queue");

// Sekali sehari jam 09:00 WIB (02:00 UTC), waktu aktual scheduler sebelumnya.
const CUSTOMER_BIRTHDAY_PATTERN = "0 2 * * *";
const CUSTOMER_BIRTHDAY_TZ = "UTC";

async function registerCustomerBirthdayScheduler() {
  // The cron is expressed in UTC; birthday selection still uses the WIB date.
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
