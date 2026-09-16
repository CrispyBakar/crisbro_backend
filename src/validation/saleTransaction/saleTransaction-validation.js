const { z } = require("zod");

const generateSaleTransactionSchema = z.object({
  customer_id: z.string().uuid("customer_id must be a valid UUID"),
});

const listSaleTransactionQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  location_id: z.string().uuid("location_id must be a valid UUID").optional(),
  sort_by: z
    .enum(["sales_time", "gross_sales", "net_sales", "subtotal", "created_at"])
    .default("sales_time"),
  sort_order: z.enum(["asc", "desc"]).default("desc"),
});

module.exports = {
  generateSaleTransactionSchema,
  listSaleTransactionQuerySchema,
};
