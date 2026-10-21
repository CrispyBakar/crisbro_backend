const express = require("express");
const router = express.Router();
const { auth, requireRole } = require("../middleware/authMiddleware");
const {
  listCustomers,
  getCustomer,
  getCustomerByUser,
  updateCustomer,
  changeCustomerStatus,
  adjustCustomerPoint,
  getMyCustomer,
  updateMyCustomer,
  getCustomerPointHistory,
  getMyPointHistory,
  generateCustomers,
  generateAllCustomerPoint,
  syncCustomer,
} = require("../controllers/customer.controller");

const adminOnly = requireRole("admin");
const adminOrMarketing = requireRole("admin", "marketing");
const customerOnly = requireRole("customer");

router.use(auth);

router.get("/me", customerOnly, getMyCustomer);
router.patch("/me", customerOnly, updateMyCustomer);
router.get("/me/point-history", customerOnly, getMyPointHistory);

router.get("/", adminOrMarketing, listCustomers);

// POST /api/customers/generate — tarik seluruh customer berpoin dari Runchise
// ke tabel lokal. Khusus admin karena memengaruhi data customer global.
router.post("/generate", adminOnly, generateCustomers);
router.get("/user/:user_id", adminOrMarketing, getCustomerByUser);
router.get("/:customer_id", adminOrMarketing, getCustomer);
router.patch("/:customer_id", adminOrMarketing, updateCustomer);
router.patch("/:customer_id/status", adminOrMarketing, changeCustomerStatus);

// POST /api/customers/:customer_id/sync — tarik data terbaru customer dari Runchise
router.post("/:customer_id/sync", adminOrMarketing, syncCustomer);

// POST /api/customers/:customer_id/adjust-point — body { point, type: "add" | "subtract", notes? }
router.post(
  "/:customer_id/adjust-point",
  adminOrMarketing,
  adjustCustomerPoint,
);
router.post("/generate-point-history", adminOnly, generateAllCustomerPoint);
router.get(
  "/:customer_id/point-history",
  adminOrMarketing,
  getCustomerPointHistory,
);

module.exports = router;
