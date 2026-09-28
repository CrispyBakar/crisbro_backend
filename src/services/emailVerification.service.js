const crypto = require("node:crypto");
const prisma = require("../lib/prisma");
const { sendEmailVerificationEmail } = require("./email.service");

const DEFAULT_TTL_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_VERIFICATION_URL =
  "https://crisbro-frontend.vercel.app/verify-email";

class EmailVerificationError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "EmailVerificationError";
    this.statusCode = statusCode;
  }
}

// Hanya hash yang disimpan di database; token mentah hanya ada di link email,
// sehingga kebocoran isi tabel User tidak bisa dipakai untuk verifikasi.
function hashVerificationToken(token) {
  return crypto
    .createHash("sha256")
    .update(String(token), "utf8")
    .digest("hex");
}

function getVerificationTtlMs() {
  const hours = Number(process.env.EMAIL_VERIFICATION_TTL_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TTL_HOURS) *
    HOUR_MS;
}

function buildVerificationUrl(token) {
  const base =
    process.env.EMAIL_VERIFICATION_URL ||
    (process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL.replace(/\/+$/, "")}/verify-email`
      : DEFAULT_VERIFICATION_URL);
  const url = new URL(base);
  url.searchParams.set("token", token);
  return url.toString();
}

/**
 * Membuat token verifikasi baru. `fields` langsung bisa digabung ke data
 * create/update Prisma User; `token` mentah dipakai untuk link email.
 */
function createEmailVerificationToken() {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + getVerificationTtlMs());

  return {
    token,
    expiresAt,
    fields: {
      email_verified: false,
      email_verification_token: hashVerificationToken(token),
      email_verification_expires: expiresAt,
    },
  };
}

async function deliverEmailVerification({ to, name, token, expiresAt }) {
  const result = await sendEmailVerificationEmail({
    to,
    name,
    verificationUrl: buildVerificationUrl(token),
    expiresAt,
  });

  if (result?.skipped) {
    console.warn(`Email verifikasi tidak dikirim ke ${to}: ${result.reason}`);
  }

  return result;
}

/**
 * Versi best-effort untuk dipanggil setelah data user tersimpan (register,
 * ganti email). Kegagalan SMTP tidak boleh membatalkan perubahan yang sudah
 * commit; user masih bisa meminta kirim ulang.
 */
async function deliverEmailVerificationSafely(payload) {
  try {
    const result = await deliverEmailVerification(payload);
    return Boolean(result?.sent);
  } catch (error) {
    console.error(`Gagal mengirim email verifikasi ke ${payload.to}:`, error);
    return false;
  }
}

async function resendEmailVerification(userId) {
  if (!userId) throw new EmailVerificationError(400, "user_id is required");

  const user = await prisma.user.findUnique({
    where: { user_id: userId },
    select: { user_id: true, email: true, username: true, email_verified: true },
  });

  if (!user) throw new EmailVerificationError(404, "User tidak ditemukan");
  if (user.email_verified) {
    throw new EmailVerificationError(409, "Email sudah terverifikasi");
  }

  const verification = createEmailVerificationToken();
  await prisma.user.update({
    where: { user_id: user.user_id },
    data: verification.fields,
  });

  const result = await deliverEmailVerification({
    to: user.email,
    name: user.username,
    token: verification.token,
    expiresAt: verification.expiresAt,
  });

  if (!result?.sent) {
    throw new EmailVerificationError(503, "Layanan email belum tersedia");
  }

  return { email: user.email, expires_at: verification.expiresAt };
}

async function verifyEmailToken(rawToken) {
  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    throw new EmailVerificationError(400, "Token verifikasi tidak valid");
  }

  const tokenHash = hashVerificationToken(token.toLowerCase());
  const user = await prisma.user.findFirst({
    where: { email_verification_token: tokenHash },
    select: { user_id: true, email_verification_expires: true },
  });

  if (
    !user ||
    !user.email_verification_expires ||
    user.email_verification_expires.getTime() < Date.now()
  ) {
    throw new EmailVerificationError(
      400,
      "Token verifikasi tidak valid atau sudah kedaluwarsa",
    );
  }

  // Syarat token ikut di WHERE: bila email diganti (token baru) di antara
  // findFirst dan update, token lama tidak boleh memverifikasi email baru.
  const { count } = await prisma.user.updateMany({
    where: { user_id: user.user_id, email_verification_token: tokenHash },
    data: {
      email_verified: true,
      email_verification_token: null,
      email_verification_expires: null,
    },
  });

  if (count === 0) {
    throw new EmailVerificationError(
      400,
      "Token verifikasi tidak valid atau sudah kedaluwarsa",
    );
  }

  return prisma.user.findUnique({ where: { user_id: user.user_id } });
}

module.exports = {
  EmailVerificationError,
  createEmailVerificationToken,
  deliverEmailVerificationSafely,
  resendEmailVerification,
  verifyEmailToken,
};
