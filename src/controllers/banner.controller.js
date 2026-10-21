const {
  BannerError,
  uploadBannerService,
  listBannersService,
  getBannerImageService,
  deleteBannerService,
} = require("../services/banner.service");
const {
  createBannerSchema,
  bannerParamsSchema,
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
  listBannersController,
  getBannerImageController,
  deleteBannerController,
};
