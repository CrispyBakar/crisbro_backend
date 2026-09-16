const { z } = require("zod");

const updateCustomerSchema = z.object({
  name: z.string().trim().min(1).optional(),
  phone_number: z.string().trim().min(1).optional(),
  email: z.string().trim().email().optional(),
  address: z.string().optional(),
  province: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  postal_code: z.string().optional(),
  gender: z.enum(["unknown", "male", "female"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  last_updated_by_id: z.string().uuid().optional(),
  owner_location_id: z.string().optional(),
  // Date-only ("YYYY-MM-DD") dari form; null menghapus tanggal lahir
  dob: z.coerce.date().optional().nullable(),
}).strict();

const deactivateCustomerSchema = z.object({
  status: z.enum(["active", "inactive"]),
});

module.exports = { updateCustomerSchema, deactivateCustomerSchema };
