const { z } = require("zod");

const createBannerSchema = z.object({
  title: z
    .string({ required_error: "Title is required" })
    .trim()
    .min(1, "Title is required"),
  status: z.enum(["active", "inactive"]).default("inactive"),
  type: z.enum(["default", "campaign"]).default("campaign"),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
});

const bannerParamsSchema = z.object({
  banner_id: z
    .string({ required_error: "banner_id is required" })
    .uuid("banner_id must be a valid UUID"),
});

module.exports = { createBannerSchema, bannerParamsSchema };
