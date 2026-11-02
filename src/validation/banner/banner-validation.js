const { z } = require("zod");
const { parseDate, parseTime } = require("../../utils/datetime");

const optionalDate = z
  .string()
  .optional()
  .refine((value) => value === undefined || value === "" || parseDate(value), {
    message: "Tanggal tidak valid",
  });
const optionalTime = z
  .string()
  .optional()
  .refine((value) => value === undefined || value === "" || parseTime(value), {
    message: "Waktu tidak valid; gunakan HH:mm atau HH:mm:ss",
  });

const createBannerSchema = z.object({
  title: z
    .string({ required_error: "Title is required" })
    .trim()
    .min(1, "Title is required"),
  status: z.enum(["active", "inactive"]).default("inactive"),
  type: z.enum(["default", "campaign"]).default("campaign"),
  start_date: optionalDate,
  end_date: optionalDate,
  start_time: optionalTime,
  end_time: optionalTime,
  redirect_type: z
    .enum(["disable", "internal", "external", "orderulang"])
    .default("disable"),
  url: z.string().optional(),
});

const editBannerSchema = createBannerSchema.partial();

const bannerParamsSchema = z.object({
  banner_id: z
    .string({ required_error: "banner_id is required" })
    .uuid("banner_id must be a valid UUID"),
});

const clickBannerSchema = z.object({
  banner_id: z
    .string({ required_error: "banner_id is required" })
    .uuid("banner_id must be a valid UUID"),
});

module.exports = {
  createBannerSchema,
  editBannerSchema,
  bannerParamsSchema,
  clickBannerSchema,
};
