const z = require("zod");

const redeemedVoucherSchema = z.object({
  promo_code_id: z.string("promo_code_id is required"),
  customer_id: z.string("customer_id is required"),
});

const redeemLoyaltyVoucherSchema = z.object({
  loyalty_product_id: z
    .string({ required_error: "loyalty_product_id is required" })
    .uuid("loyalty_product_id must be a valid UUID"),
});

const redeemTransactionParamsSchema = z.object({
  redeem_transaction_id: z
    .string()
    .uuid("redeem_transaction_id must be a valid UUID"),
});

const listMyRedeemedVoucherQuerySchema = z.object({
  // Batas page menjaga skip tetap di bawah batas Int Prisma.
  page: z.coerce.number().int().positive().max(1_000_000).default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  sort_order: z.enum(["asc", "desc"]).default("desc"),
});

const listRedeemedVoucherQuerySchema = listMyRedeemedVoucherQuerySchema.extend({
  search: z.string().trim().default(""),
  customer_id: z.string().uuid("customer_id must be a valid UUID").optional(),
  promo_id: z.string().uuid("promo_id must be a valid UUID").optional(),
});

module.exports = {
  redeemedVoucherSchema,
  redeemLoyaltyVoucherSchema,
  redeemTransactionParamsSchema,
  listMyRedeemedVoucherQuerySchema,
  listRedeemedVoucherQuerySchema,
};
