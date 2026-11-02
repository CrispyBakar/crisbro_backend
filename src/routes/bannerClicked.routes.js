const {
  listBannerClickedController,
  getBannerClickedAnalyticsController,
} = require("../controllers/bannerClicked.controller");
const { auth, requireRole } = require("../middleware/authMiddleware");

const router = require("express").Router();

router.get(
  "/analytics",
  auth,
  requireRole("admin", "marketing"),
  getBannerClickedAnalyticsController,
);

router.get(
  "/",
  auth,
  requireRole("admin", "marketing"),
  listBannerClickedController,
);

module.exports = router;
