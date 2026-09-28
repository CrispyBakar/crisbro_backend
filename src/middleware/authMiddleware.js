// Mengimpor library JWT dan fungsi untuk mengambil JWT_SECRET
const jwt = require("jsonwebtoken");
const getJwtSecret = require("../lib/jwtSecret");
const prisma = require("../lib/prisma");
const {
  getSessionCookie,
  clearSessionCookie,
} = require("../lib/sessionCookie");
const {
  findActiveSession,
  touchSession,
} = require("../services/session.service");

// Middleware untuk memverifikasi token JWT pada setiap request
const auth = async (req, res, next) => {
  const header = req.headers.authorization;
  const bearerToken =
    typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice(7).trim()
      : null;
  const cookieToken = getSessionCookie(req);
  // Cookie diprioritaskan untuk browser; Bearer dipertahankan bagi tooling API.
  const token = cookieToken || bearerToken;

  // Jika token tidak ditemukan, akses ditolak
  if (!token) {
    return res.status(401).json({
      message: "Unauthorized",
    });
  }

  let decoded;
  try {
    // Memverifikasi token menggunakan JWT_SECRET
    decoded = jwt.verify(token, getJwtSecret());

    if (!decoded.user_id) {
      throw new jwt.JsonWebTokenError("Token tidak memiliki user_id");
    }
  } catch (error) {
    if (cookieToken) clearSessionCookie(res);
    // Menangani jika JWT_SECRET belum dikonfigurasi
    if (error.code === "JWT_SECRET_MISSING") {
      return res.status(500).json({
        message: "Authentication configuration error",
      });
    }

    // Menangani jika token sudah kedaluwarsa
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        message: "Token expired",
      });
    }

    // Menangani token yang tidak valid
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }

  // JWT yang sah saja tidak cukup: token harus masih punya baris Session.
  // Logout, logout-all, ganti password, revoke admin, idle timeout, dan
  // penghapusan user (cascade) semuanya bekerja dengan menghapus baris ini.
  // Error database diteruskan ke error handler (500) dan cookie tidak dihapus,
  // supaya gangguan database sesaat tidak membuat semua user ter-logout.
  let session;
  try {
    session = await findActiveSession(token, decoded.user_id);
  } catch (error) {
    return next(error);
  }

  if (!session) {
    if (cookieToken) clearSessionCookie(res);
    return res
      .status(401)
      .json({ message: "Sesi berakhir, silakan login kembali" });
  }

  const { user } = session;
  const tokenExpMs =
    typeof decoded.exp === "number" ? decoded.exp * 1000 : Number.NaN;
  await touchSession(session, { role: user.role, tokenExpMs });

  // Role diambil dari database, bukan klaim JWT, supaya perubahan role oleh
  // admin langsung berlaku. `id` dipertahankan untuk controller lama.
  req.user = {
    ...decoded,
    role: user.role,
    id: user.user_id,
    user_id: user.user_id,
    session_id: session.session_id,
  };

  return next();
};

const requireValidPhone = async (req, res, next) => {
  const user_id = req.user.user_id ?? undefined;

  if (!user_id)
    return res.status(403).json({
      message: "Invalid User",
    });

  try {
    const user = await prisma.user.findUnique({ where: { user_id } });

    if (!user)
      return res.status(404).json({
        message: "User not found",
      });

    if (!user.phone_verified)
      return res.status(403).json({
        message: "Please validate your phone number",
      });

    return next();
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      message: "Unhandled error",
    });
  }
};

const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    // Memeriksa apakah user sudah login dan memiliki role yang diizinkan
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Melanjutkan ke middleware atau controller berikutnya jika role sesuai
    next();
  };
};

module.exports = { auth, requireValidPhone, requireRole };
