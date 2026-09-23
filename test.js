const {
  generateAllCustomerHasPoint,
} = require("./src/services/runchise.service");

async function main() {
  const result = await generateAllCustomerHasPoint();
}

main();
