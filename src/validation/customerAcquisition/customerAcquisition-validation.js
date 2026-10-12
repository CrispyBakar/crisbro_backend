const { z } = require("zod");

const acquisitionText = (field) =>
  z
    .string({ required_error: `${field} is required` })
    .trim()
    .min(1, `${field} is required`)
    .max(100, `${field} must be at most 100 characters`);

// Dipakai customer untuk dirinya sendiri: customer diambil dari sesi login.
const createMyCustomerAcquisitionSchema = z.object({
  source: acquisitionText("source"),
  captured_via: acquisitionText("captured_via"),
});

const createCustomerAcquisitionSchema =
  createMyCustomerAcquisitionSchema.extend({
    customer_id: z
      .string({ required_error: "customer_id is required" })
      .uuid("customer_id must be a valid UUID"),
  });

const customerAcquisitionParamsSchema = z.object({
  customer_id: z.string().uuid("customer_id must be a valid UUID"),
});

module.exports = {
  customerAcquisitionParamsSchema,
  createMyCustomerAcquisitionSchema,
  createCustomerAcquisitionSchema,
};
