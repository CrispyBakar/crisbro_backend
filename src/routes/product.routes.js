const express = require("express");
const router = express.Router();
const { auth, requireRole } = require("../middleware/authMiddleware");
const {
  listLoyaltyProductsController,
  syncLoyaltyProductsController,
  deleteLoyaltyProductController,
  syncProductsController,
  listAllProductsController,
} = require("../controllers/product.controller");

router.get(
  "/",
  auth,
  requireRole("admin", "marketing"),
  listAllProductsController,
);

router.get("/loyalty", auth, listLoyaltyProductsController);

router.post(
  "/sync-products",
  auth,
  requireRole("admin", "marketing"),
  syncProductsController,
);

router.post(
  "/sync-loyalty-products",
  auth,
  requireRole("admin", "marketing"),
  syncLoyaltyProductsController,
);

router.delete(
  "/:loyalty_product_id",
  auth,
  requireRole("admin", "marketing"),
  deleteLoyaltyProductController,
);

module.exports = router;
