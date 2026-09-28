const prisma = require("../lib/prisma");
const { hashSessionToken } = require("../lib/sessionToken");
const {
  computeSessionExpiry,
  computeSlidingSessionExpiry,
} = require("../lib/sessionPolicy");

const MAX_USER_AGENT_LENGTH = 512;

function truncate(value, max) {
  return typeof value === "string" && value !== "" ? value.slice(0, max) : null;
}

async function createSession({
  userId,
  role,
  token,
  tokenExpMs,
  userAgent,
  ipAddress,
}) {
  const now = Date.now();

  // Tidak ada cron di serverless; login jadi titik bersih-bersih sesi
  // kedaluwarsa milik user yang sama supaya tabel tidak terus tumbuh.
  await prisma.session.deleteMany({
    where: { user_id: userId, expires_at: { lte: new Date(now) } },
  });

  return prisma.session.create({
    data: {
      user_id: userId,
      token_hash: hashSessionToken(token),
      expires_at: computeSessionExpiry({ role, now, tokenExpMs }),
      user_agent: truncate(userAgent, MAX_USER_AGENT_LENGTH),
      ip_address: truncate(ipAddress, 64),
    },
  });
}

/**
 * Sesi aktif milik token, beserta user-nya, atau `null` bila token sudah
 * di-revoke, kedaluwarsa idle, atau bukan milik `userId` dari JWT.
 */
async function findActiveSession(token, userId) {
  const session = await prisma.session.findUnique({
    where: { token_hash: hashSessionToken(token) },
    include: { user: { select: { user_id: true, role: true } } },
  });

  if (!session || session.user_id !== userId) return null;

  if (session.expires_at.getTime() <= Date.now()) {
    await prisma.session
      .delete({ where: { session_id: session.session_id } })
      .catch(() => {});
    return null;
  }

  return session;
}

/**
 * Menggeser batas idle. Ditulis hanya bila selisihnya melewati ambang
 * SESSION_RENEW_INTERVAL_MINUTES agar tidak ada UPDATE di setiap request.
 */
async function touchSession(session, { role, tokenExpMs }) {
  const nextExpiry = computeSlidingSessionExpiry({
    role,
    now: Date.now(),
    tokenExpMs,
    currentExpiresAt: session.expires_at,
  });
  if (!nextExpiry) return;

  try {
    await prisma.session.update({
      where: { session_id: session.session_id },
      data: { expires_at: nextExpiry, last_used_at: new Date() },
    });
  } catch (error) {
    // Sesi bisa saja baru di-logout oleh request paralel (P2025). Gagal
    // memperpanjang tidak boleh menggagalkan request yang sudah sah.
    if (error?.code !== "P2025") {
      console.error("Gagal memperpanjang sesi:", error);
    }
  }
}

async function revokeSession(sessionId) {
  if (!sessionId) return 0;
  const { count } = await prisma.session.deleteMany({
    where: { session_id: sessionId },
  });
  return count;
}

async function revokeUserSessions(userId, client = prisma) {
  if (!userId) return 0;
  const { count } = await client.session.deleteMany({
    where: { user_id: userId },
  });
  return count;
}

module.exports = {
  createSession,
  findActiveSession,
  touchSession,
  revokeSession,
  revokeUserSessions,
};
