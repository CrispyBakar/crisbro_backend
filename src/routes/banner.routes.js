const router = require("express").Router();
const {
  auth,
  requireRole,
  guestOrAuthenticate,
} = require("../middleware/authMiddleware");
const { imageUpload } = require("../middleware/imageUpload");
const {
  uploadBannerController,
  editBannerController,
  listBannersController,
  getBannerImageController,
  clickBannerController,
  deleteBannerController,
} = require("../controllers/banner.controller");

const BANNER_MAX_BYTES = 2 * 1024 * 1024;
const BANNER_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Publik: banner ditampilkan ke semua pengunjung, termasuk yang belum login.
router.get("/", listBannersController);
router.get("/:banner_id/image", getBannerImageController);
router.post("/click", guestOrAuthenticate, clickBannerController);

router.post(
  "/upload",
  auth,
  requireRole("admin", "marketing"),
  imageUpload({
    fieldName: "image",
    maxBytes: BANNER_MAX_BYTES,
    allowedMimeTypes: BANNER_MIME_TYPES,
  }),
  uploadBannerController,
);

router.put(
  "/:banner_id",
  auth,
  requireRole("admin", "marketing"),
  imageUpload({
    fieldName: "image",
    maxBytes: BANNER_MAX_BYTES,
    allowedMimeTypes: BANNER_MIME_TYPES,
  }),
  editBannerController,
);

router.delete(
  "/:banner_id",
  auth,
  requireRole("admin", "marketing"),
  deleteBannerController,
);

module.exports = router;
