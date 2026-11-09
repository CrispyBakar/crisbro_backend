const { auth, requireRole } = require("../middleware/authMiddleware");
const {
  getMyBirthdayTreatController,
  claimCustomerBirthdayTreatController,
  promoCodeInformation,
} = require("../controllers/birthday.controller");

const router = require("express").Router();

// Cek birthday treat milik customer yang sedang login (untuk popup claim
// voucher setelah login). Khusus customer: staff tidak punya treat.
router.get("/me", auth, requireRole("customer"), getMyBirthdayTreatController);
router.post(
  "/me/claim",
  auth,
  requireRole("customer"),
  claimCustomerBirthdayTreatController,
);
// Get Promo information terms and contions
router.get("/promo/promoCode/:promoCodeId", auth, promoCodeInformation);

module.exports = router;
