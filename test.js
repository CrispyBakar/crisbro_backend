const {
  redeemLoyaltyVoucher,
} = require("./src/services/redeemTransaction.service");

async function main() {
  const user_id = "7546015e-23a7-4f67-abc2-77fe03c9b175";
  const loyalty_product_id = "d5b590c3-2dd9-4dbf-9418-4fb88f79f14c";
  await redeemLoyaltyVoucher(user_id, loyalty_product_id);
}

main();
