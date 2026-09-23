const express = require("express");
const router = express.Router();
const { auth, requireRole } = require("../middleware/authMiddleware");
const {
  saleTransactionGenerateLimiter,
  saleTransactionGenerateAllLimiter,
} = require("../lib/rateLimit");
const {
  generateSaleTransactions,
  generateAllSaleTransactions,
  getSaleTransactionsByCustomer,
} = require("../controllers/saleTransaction.controller");

const adminOnly = requireRole("admin");
const adminOrMarketing = requireRole("admin", "marketing");

router.use(auth);

// Daftar sale transaction milik satu customer dari tabel lokal hasil
// sinkronisasi Runchise.
router.get(
  "/customer/:customer_id",
  adminOrMarketing,
  getSaleTransactionsByCustomer,
);

// Menarik sale transaction milik satu customer dari Runchise (paginated)
// lalu menyimpannya ke tabel SaleTransaction. Limiter diletakkan setelah
// cek role agar kuota per customer hanya dihabiskan request yang sah.
router.post(
  "/generate",
  adminOnly,
  saleTransactionGenerateLimiter,
  generateSaleTransactions,
);

// Menarik sale transaction SELURUH customer tersinkon Runchise sekaligus —
// jauh lebih berat daripada /generate (memanggil API Runchise per customer),
// sehingga limiter-nya jauh lebih ketat.
router.post(
  "/generate-all",
  adminOnly,
  saleTransactionGenerateAllLimiter,
  generateAllSaleTransactions,
);

module.exports = router;
