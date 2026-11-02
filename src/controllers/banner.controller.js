const {
  BannerError,
  uploadBannerService,
  editBannerService,
  listBannersService,
  getBannerImageService,
  deleteBannerService,
  clickBannerService,
} = require("../services/banner.service");
const {
  createBannerSchema,
  editBannerSchema,
  bannerParamsSchema,
  clickBannerSchema,
} = require("../validation/banner/banner-validation");
const { setSharedResponseCacheHeaders } = require("../lib/responseCache");

const {
  badRequest,
  successRequest,
  respondWithServerError,
} = require("../utils/responseReuest");

// Hanya BannerError yang pesannya aman ditampilkan; error lain (Prisma)
// jangan diteruskan mentah ke client.
function respondBannerError(res, error, context) {
  if (error instanceof BannerError) {
    return badRequest({ res, code: error.statusCode, error: error.message });
  }

  return respondWithServerError(res, error, context);
}

async function uploadBannerController(req, res) {
  const validate = createBannerSchema.safeParse(req.body ?? {});

  const fieldErrors = validate.success
    ? {}
    : validate.error.flatten().fieldErrors;
  if (!req.file) fieldErrors.image = ["Image is required"];

  if (Object.keys(fieldErrors).length > 0) {
    return badRequest({ code: 422, res, error: fieldErrors });
  }

  try {
    const result = await uploadBannerService({
      ...validate.data,
      image: req.file,
    });

    return successRequest({
      res,
      code: 201,
      data: result,
      message: "Banner uploaded",
    });
  } catch (error) {
    return respondBannerError(res, error, "Upload banner");
  }
}

async function editBannerController(req, res) {
  const params = bannerParamsSchema.safeParse(req.params);
  if (!params.success) {
    return badRequest({
      code: 422,
      res,
      error: params.error.flatten().fieldErrors,
    });
  }

  const body = editBannerSchema.safeParse(req.body ?? {});
  const fieldErrors = body.success ? {} : body.error.flatten().fieldErrors;
  if (!body.success && req.file) delete fieldErrors.image;

  if (Object.keys(fieldErrors).length > 0) {
    return badRequest({ code: 422, res, error: fieldErrors });
  }

  if (Object.keys(body.data ?? {}).length === 0 && !req.file) {
    return badRequest({
      code: 422,
      res,
      error: { body: ["At least one field or image is required"] },
    });
  }

  try {
    const result = await editBannerService(params.data.banner_id, {
      ...body.data,
      image: req.file,
    });

    return successRequest({ res, data: result, message: "Banner updated" });
  } catch (error) {
    return respondBannerError(res, error, "Edit banner");
  }
}

async function listBannersController(req, res) {
  try {
    const result = await listBannersService();

    return successRequest({ res, data: result, message: "Banner list" });
  } catch (error) {
    return respondBannerError(res, error, "List banner");
  }
}

async function getBannerImageController(req, res) {
  const validate = bannerParamsSchema.safeParse(req.params);

  if (!validate.success) {
    return badRequest({
      code: 422,
      res,
      error: validate.error.flatten().fieldErrors,
    });
  }

  try {
    const banner = await getBannerImageService(validate.data.banner_id);

    setSharedResponseCacheHeaders(res);
    // Helmet default-nya same-origin; frontend beda origin perlu memuat
    // gambar ini lewat <img>.
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.removeHeader("Pragma");

    return res.type(banner.mime_type).send(Buffer.from(banner.image_data));
  } catch (error) {
    return respondBannerError(res, error, "Get banner image");
  }
}

async function clickBannerController(req, res) {
  const validation = clickBannerSchema.safeParse(req.body ?? {});

  if (!validation.success) {
    return badRequest({
      code: 422,
      res,
      error: validation.error.flatten().fieldErrors,
    });
  }

  try {
    const data = await clickBannerService({
      bannerId: validation.data.banner_id,
      userId: req.user?.user_id ?? null,
      userAgent: req.get("user-agent") ?? null,
      ipAddress: req.ip ?? null,
    });

    return successRequest({
      res,
      code: 201,
      data,
      message: "Banner click recorded",
    });
  } catch (error) {
    return respondBannerError(res, error, "Record banner click");
  }
}

async function deleteBannerController(req, res) {
  const validate = bannerParamsSchema.safeParse(req.params);

  if (!validate.success) {
    return badRequest({
      code: 422,
      res,
      error: validate.error.flatten().fieldErrors,
    });
  }

  try {
    const result = await deleteBannerService(validate.data.banner_id);

    return successRequest({ res, data: result, message: "Banner deleted" });
  } catch (error) {
    return respondBannerError(res, error, "Delete banner");
  }
}

module.exports = {
  uploadBannerController,
  editBannerController,
  listBannersController,
  getBannerImageController,
  clickBannerController,
  deleteBannerController,
};
