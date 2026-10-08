const { z } = require("zod");

const passwordSchema = z
  .string()
  .min(8)
  .regex(/[A-Z]/, "Password harus mengandung huruf besar")
  .regex(/[0-9]/, "Password harus mengandung angka");

const registerSchemaValidation = z.object({
  referral_code: z.string().optional(),
  name: z.string(),
  phone: z
    .string()
    .min(11)
    .max(15)
    .regex(/^[1-9]\d*$/, {
      message: "Nomor telepon tidak boleh diawali angka 0",
    }),
  username: z.string().min(6),
  email: z.string().email("Format email tidak valid"),
  password: passwordSchema,
  role: z.string().default("customer"),
  location_id: z.number(),
});

const loginSchemaValidation = z
  .object({
    phone: z
      .string()
      .min(11)
      .max(15)
      .regex(/^[1-9]\d*$/, {
        message: "Nomor telepon tidak boleh diawali angka 0",
      })
      .optional(),
    email: z.string().email("Format email tidak valid").optional(),
    password: z.string().min(1, "Password wajib diisi"),
  })
  .refine((data) => data.phone || data.email, {
    message: "Harus mengisi salah satu: nomor telepon atau email",
    path: ["phone"], // atau ["email"], atau bisa dihilangkan
  })
  .refine((data) => !(data.phone && data.email), {
    message: "Isi salah satu saja: nomor telepon atau email, tidak keduanya",
    path: ["email"],
  });

const forgotPasswordSchemaValidation = z.object({
  email: z.string().trim().email("Format email tidak valid"),
});

const resetPasswordSchemaValidation = z.object({
  token: z.string().trim().min(1, "Token wajib diisi").max(200),
  new_password: passwordSchema,
});

module.exports = {
  registerSchemaValidation,
  loginSchemaValidation,
  forgotPasswordSchemaValidation,
  resetPasswordSchemaValidation,
};
