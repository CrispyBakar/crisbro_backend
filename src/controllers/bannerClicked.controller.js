const {
  listBannerClickedService,
  getBannerClickedAnalyticsService,
} = require("../services/bannerClicked.service");
const { successRequest, badRequest } = require("../utils/responseReuest");
const { z } = require("zod");
const { parseDate } = require("../utils/datetime");

const bannerClickedAnalyticsQuerySchema = z
  .object({
    start_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => parseDate(value, { dateOnlyAsUTC: true }) !== null),
    end_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((value) => parseDate(value, { dateOnlyAsUTC: true }) !== null),
    banner_id: z.string().uuid().optional(),
    user_id: z.string().uuid().optional(),
  })
  .strict()
  .refine((value) => value.start_date <= value.end_date, {
    message: "end_date harus sama dengan atau setelah start_date",
    path: ["end_date"],
  });

async function getBannerClickedAnalyticsController(req, res) {
  const validation = bannerClickedAnalyticsQuerySchema.safeParse(req.query);
  if (!validation.success) {
    return badRequest({
      res,
      code: 422,
      error: validation.error.flatten().fieldErrors,
    });
  }

  try {
    const data = await getBannerClickedAnalyticsService(validation.data);
    return successRequest({
      res,
      code: 200,
      data,
      message: "Banner clicked analytics retrieved successfully.",
    });
  } catch (error) {
    return badRequest({
      res,
      code: 500,
      error: error.message,
    });
  }
}

async function listBannerClickedController(req, res) {
  try {
    const { take = 10, skip = 0, banner_id, user_id } = req.query;

    const parsedTake = Math.min(Number.parseInt(take, 10));
    const parsedSkip = Math.max(Number.parseInt(skip, 10));

    const result = await listBannerClickedService({
      take: parsedTake,
      skip: parsedSkip,
      banner_id,
      user_id,
    });

    return successRequest({
      res,
      code: 200,
      data: result,
      message: "Banner clicked retrieved successfully.",
    });
  } catch (error) {
    return badRequest({
      res,
      code: 500,
      error: error.message,
    });
  }
}

module.exports = {
  listBannerClickedController,
  getBannerClickedAnalyticsController,
  bannerClickedAnalyticsQuerySchema,
};
