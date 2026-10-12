const express = require("express");
const router = express.Router();
const { auth, requireRole } = require("../middleware/authMiddleware");
const {
  getCustomerAcquisitionController,
  createCustomerAcquisitionController,
  createMyCustomerAcquisitionController,
} = require("../controllers/customerAcquisition.controller");

// Customer mengisi sumber akuisisinya sendiri (mis. dari form setelah daftar).
router.post(
  "/me",
  auth,
  requireRole("customer"),
  createMyCustomerAcquisitionController,
);

// Admin/marketing mencatat sumber akuisisi untuk customer tertentu.
router.post(
  "/",
  auth,
  requireRole("admin", "marketing"),
  createCustomerAcquisitionController,
);

// Admin/marketing melihat sumber akuisisi milik customer tertentu.
router.get(
  "/customer/:customer_id",
  auth,
  requireRole("admin", "marketing"),
  getCustomerAcquisitionController,
);

module.exports = router;
