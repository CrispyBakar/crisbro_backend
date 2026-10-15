const { Queue } = require("bullmq");
const { connection } = require("./redis");

const syncQueue = new Queue("customer-sync", { connection });
const pointQueue = new Queue("customer-point-daily", { connection });
const productQueue = new Queue("product-sync", { connection });
const pushQueue = new Queue("push-broadcast", { connection });
const birthdayQueue = new Queue("customer-birthday", { connection });

module.exports = {
  syncQueue,
  pointQueue,
  productQueue,
  pushQueue,
  birthdayQueue,
};
