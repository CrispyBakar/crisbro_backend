// Mengimpor Express untuk membuat router
const express = require("express");
const router = express.Router();

// Mengimpor middleware autentikasi dan controller auth
const {
  auth,
  requireValidPhone,
  requireRole,
} = require("../middleware/authMiddleware");
const {
  authIpLimiter,
  loginAccountLimiter,
  emailVerificationUserLimiter,
} = require("../lib/rateLimit");
const {
  register,
  login,
  logout,
  logoutAllSessions,
  profile,
  changePassword,
  sendOnlyOtpCode,
  otpCodeValidation,
  sendEmailVerification,
  verifyEmail,
} = require("../controllers/auth.controller");

// ===================== REGISTER =====================
router.post("/register", register);

// ===================== LOGIN =====================
router.post("/login", authIpLimiter, loginAccountLimiter, login);

// ==================== SEND OTP ====================
router.post("/send-otp", authIpLimiter, auth, sendOnlyOtpCode);

// ===================== VERIFY OTP ===================
router.post("/verify-otp", authIpLimiter, auth, otpCodeValidation);

// ================= EMAIL VERIFICATION =================
router.post(
  "/send-email-verification",
  authIpLimiter,
  auth,
  emailVerificationUserLimiter,
  sendEmailVerification,
);
// Publik: token dari link email adalah buktinya, user belum tentu login.
router.post("/verify-email", authIpLimiter, verifyEmail);

// ===================== LOGOUT =====================
router.post("/logout", auth, logout);
router.post("/logout-all", auth, logoutAllSessions);

// ===================== PROFILE =====================
router.get("/profile", auth, requireValidPhone, profile);

// ============ ME (khusus marketing & admin, tanpa validasi phone) ============
router.get("/me", auth, requireRole("marketing", "admin"), profile);

// ===================== CHANGE PASSWORD =====================
router.post("/change-password", auth, authIpLimiter, changePassword);

module.exports = router;
