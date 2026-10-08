const z = require("zod");

const redeemedVoucherSchema = z.object({
  promo_code_id: z.string("promo_code_id is required"),
  customer_id: z.string("customer_id is required"),
});

module.exports = { redeemedVoucherSchema };
