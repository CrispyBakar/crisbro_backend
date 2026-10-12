const express = require("express");
const router = express.Router();
const {
  auth,
  requireValidPhone,
  requireRole,
} = require("../middleware/authMiddleware");
const {
  redeemLoyaltyVoucherController,
  listMyRedeemedVouchersController,
  getMyRedeemedVoucherController,
  listRedeemedVouchersController,
  getRedeemedVoucherController,
} = require("../controllers/redeemTransaction.controller");

// Tukar poin dengan voucher loyalty product. Khusus customer: admin/marketing
// tidak punya saldo poin untuk ditukar. Nomor telepon wajib terverifikasi.
router.post(
  "/",
  auth,
  requireRole("customer"),
  requireValidPhone,
  redeemLoyaltyVoucherController,
);

// Voucher milik customer yang sedang login. Harus didaftarkan sebelum
// "/:redeem_transaction_id" supaya "me" tidak terbaca sebagai ID.
router.get(
  "/me",
  auth,
  requireRole("customer"),
  listMyRedeemedVouchersController,
);
router.get(
  "/me/:redeem_transaction_id",
  auth,
  requireRole("customer"),
  getMyRedeemedVoucherController,
);

// Semua voucher yang sudah di-redeem beserta customer yang menukarnya.
router.get(
  "/",
  auth,
  requireRole("admin", "marketing"),
  listRedeemedVouchersController,
);
router.get(
  "/:redeem_transaction_id",
  auth,
  requireRole("admin", "marketing"),
  getRedeemedVoucherController,
);

module.exports = router;
