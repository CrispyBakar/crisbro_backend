const express = require("express");
const router = express.Router();
const { auth, requireRole } = require("../middleware/authMiddleware");
const {
  getVapidPublicKeyController,
  subscribeController,
  unsubscribeController,
  sendTestController,
  createBroadcastController,
  listBroadcastsController,
} = require("../controllers/push.controller");

// Public key VAPID memang publik; dipakai browser saat subscribe
router.get("/vapid-public-key", getVapidPublicKeyController);

// Admin & marketing juga subscribe untuk menerima notifikasi operasional
// (mis. referral baru yang perlu divalidasi)
router.post(
  "/subscribe",
  auth,
  requireRole("customer", "admin", "marketing"),
  subscribeController,
);

// Siapapun yang login boleh menghapus subscription miliknya
router.post("/unsubscribe", auth, unsubscribeController);
router.post(
  "/test",
  auth,
  requireRole("customer", "admin", "marketing"),
  sendTestController,
);

router.get(
  "/broadcasts",
  auth,
  requireRole("admin", "marketing"),
  listBroadcastsController,
);
router.post(
  "/broadcasts",
  auth,
  requireRole("admin", "marketing"),
  createBroadcastController,
);

module.exports = router;
