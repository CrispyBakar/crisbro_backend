const express = require("express");
const router = express.Router();
const { auth, requireRole } = require("../middleware/authMiddleware");
const {
  getTotalCountsController,
  getCustomersPerOutletController,
  getTopRedeemedProductsController,
  getRecentTransactionsController,
} = require("../controllers/dashboard.controller");

router.get(
  "/total-counts",
  auth,
  requireRole("admin", "marketing"),
  getTotalCountsController,
);

router.get(
  "/customers-per-outlet",
  auth,
  requireRole("admin", "marketing"),
  getCustomersPerOutletController,
);

router.get(
  "/top-redeemed-products",
  auth,
  requireRole("admin", "marketing"),
  getTopRedeemedProductsController,
);

router.get(
  "/recent-transactions",
  auth,
  requireRole("admin", "marketing"),
  getRecentTransactionsController,
);

module.exports = router;
