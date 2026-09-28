const { Queue } = require("bullmq");
const { connection } = require("./redis");

const syncQueue = new Queue("customer-sync", { connection });
const pointQueue = new Queue("customer-point-daily", { connection });
const productQueue = new Queue("product-sync", { connection });

module.exports = { syncQueue, pointQueue, productQueue };
