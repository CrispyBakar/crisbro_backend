const { successRequest, badRequest } = require("../utils/responseReuest");
const {
  CreateReferralProgramSchema,
} = require("../validation/referral/referral-validation");
const {
  generateReferralCodeService,
  renewReferralCodeService,
  validateReferralCodeService,
  listReferralCodeUsagesService,
} = require("../services/referral.service");
const { z } = require("zod");
const {
  DEFAULT_POINT_REWARD,
  DEFAULT_POINT_GIVEN,
  getDefaultExpiresTime,
} = require("../constants/referralCodeValue");
const { notifyUserSafely } = require("../services/push.service");

const userIdSchema = z.string().uuid("User ID must be a valid UUID");
const listReferralUsagesQuerySchema = z.object({
  status: z
    .enum(["pending", "completed"], {
      errorMap: () => ({ message: "Status must be pending or completed" }),
    })
    .optional(),
  page: z.coerce.number().int().min(1).max(2147483647).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

async function generateReferralCodeController(req, res) {
  const { user_id } = req.user ?? {};
  const body = req.body ?? undefined;
  let payload;

  if (!body || Object.keys(body).length === 0) {
    payload = {
      owner_referral: user_id,
      point_reward: DEFAULT_POINT_REWARD,
      point_given: DEFAULT_POINT_GIVEN,
      expires_at: getDefaultExpiresTime(),
    };
  } else {
    payload = {
      ...body,
      owner_referral: user_id,
      expires_at: new Date(body.expires_at),
    };
  }

  const validate = await CreateReferralProgramSchema.safeParse(payload);

  if (!validate.success) {
    return badRequest({
      code: 422,
      res,
      error: validate.error.flatten().fieldErrors,
    });
  }

  const data = validate.data;

  const response = await generateReferralCodeService({
    user_id,
    payload: data,
  });

  if (response.code !== 200) {
    return badRequest({
      res,
      code: response.code,
      error: response.message,
    });
  }

  return successRequest({ res, code: response.code, data: response.data });
}

async function renewReferralCodeController(req, res) {
  const { user_id } = req.user ?? {};
  const body = req.body ?? {};
  const payload = {
    ...body,
    owner_referral: user_id,
    expires_at: body.expires_at
      ? new Date(body.expires_at)
      : getDefaultExpiresTime(),
    point_reward: body.point_reward ?? DEFAULT_POINT_REWARD,
    point_given: body.point_given ?? DEFAULT_POINT_GIVEN,
  };

  const validation = CreateReferralProgramSchema.safeParse(payload);

  if (!validation.success) {
    return badRequest({
      res,
      code: 422,
      error: validation.error.flatten().fieldErrors,
    });
  }

  const response = await renewReferralCodeService({
    user_id,
    payload: validation.data,
  });

  if (response.code !== 200) {
    return badRequest({
      res,
      code: response.code,
      error: response.message,
    });
  }

  return successRequest({ res, code: response.code, data: response.data });
}

async function validateReferralCodeController(req, res) {
  const validation = userIdSchema.safeParse(req.params.user_id);

  if (!validation.success) {
    return badRequest({
      res,
      code: 422,
      error: validation.error.flatten().formErrors,
    });
  }

  const response = await validateReferralCodeService({
    user_id: validation.data,
  });

  if (response.code !== 200) {
    return badRequest({
      res,
      code: response.code,
      error: response.message,
    });
  }

  // Ditunggu sebelum response: Netlify Function bisa dibekukan begitu
  // response terkirim. notifyUserSafely tidak pernah throw

  const { referrer_user_id, referred_user_id, points_awarded } = response.data;

  await Promise.all([
    points_awarded.referrer > 0 &&
      notifyUserSafely(referrer_user_id, {
        title: "Referral berhasil! 🎁",
        body: `Temanmu sudah terverifikasi. Kamu dapat +${points_awarded.referrer} poin`,
        url: "/settings/point-history",
        tag: "referral",
      }),
    points_awarded.referred > 0 &&
      notifyUserSafely(referred_user_id, {
        title: "Bonus referral masuk! 🎁",
        body: `+${points_awarded.referred} poin sudah ditambahkan ke akunmu.`,
        url: "/settings/point-history",
        tag: "referral",
      }),
  ]);

  return successRequest({
    res,
    code: response.code,
    data: response.data,
    message: "Referral validated successfully",
  });
}

async function listReferralCodeUsagesController(req, res) {
  const validation = listReferralUsagesQuerySchema.safeParse(req.query);

  if (!validation.success) {
    return badRequest({
      res,
      code: 422,
      error: validation.error.flatten().fieldErrors,
    });
  }

  const response = await listReferralCodeUsagesService(validation.data);

  return successRequest({
    res,
    code: response.code,
    data: {
      items: response.data,
      meta: response.meta,
    },
    message: "Referral usages retrieved successfully",
  });
}

module.exports = {
  generateReferralCodeController,
  renewReferralCodeController,
  validateReferralCodeController,
  listReferralCodeUsagesController,
};
