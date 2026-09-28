const bcrypt = require("bcrypt");
const prisma = require("../lib/prisma");
const { normalizePhone, phoneVariants } = require("../lib/phoneNumber");
const {
  createEmailVerificationToken,
  deliverEmailVerificationSafely,
} = require("./emailVerification.service");
const { revokeUserSessions } = require("./session.service");

const BCRYPT_ROUNDS = 10;
const STAFF_EMAIL_PATTERN = /^[^\s@]+@crisbar\.id$/i;
const INVALID_EMAIL_DOMAIN_MESSAGE = "Email harus menggunakan domain @crisbar.id";
const ALLOWED_CREATE_FIELDS = [
  "email",
  "username",
  "password",
  "phone",
  "role",
  "referral_code",
  "no_referensi",
  "status",
];
const ALLOWED_UPDATE_FIELDS = [
  "email",
  "username",
  "password",
  "phone",
  "role",
  "referral_code",
  "no_referensi",
  "status",
];

function pickAllowedFields(payload = {}, allowedFields) {
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => allowedFields.includes(key)),
  );
}

async function createUserService(payload) {
  const data = pickAllowedFields(payload, ALLOWED_CREATE_FIELDS);

  if (Object.keys(data).length === 0) {
    throw new Error("No valid fields to create");
  }

  try {
    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { email: data.email },
          { username: data.username },
          { phone: data.phone },
        ],
      },
    });

    if (existing)
      throw new Error("User with username/email/phone has been created.");

    if (data.password !== undefined) {
      data.password_hash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
      delete data.password;
    }

    const verification = data.email ? createEmailVerificationToken() : null;
    if (verification) Object.assign(data, verification.fields);

    const user = await prisma.user.create({
      data,
    });

    if (verification) {
      await deliverEmailVerificationSafely({
        to: user.email,
        name: user.username,
        token: verification.token,
        expiresAt: verification.expiresAt,
      });
    }

    return user;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function updateUserService(user_id, payload) {
  if (!user_id) throw new Error("user_id is required");

  const data = pickAllowedFields(payload, ALLOWED_UPDATE_FIELDS);

  if (Object.keys(data).length === 0) {
    throw new Error("No valid fields to update");
  }

  try {
    const user = await prisma.user.findUnique({
      where: { user_id: user_id },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const emailChanged = data.email !== undefined && data.email !== user.email;

    // Email staff dipakai untuk login dan hanya boleh berdomain perusahaan
    if (emailChanged && !STAFF_EMAIL_PATTERN.test(data.email)) {
      throw new Error(INVALID_EMAIL_DOMAIN_MESSAGE);
    }

    // Pastikan email/username/phone/referral_code/no_referensi tidak dipakai user lain
    const uniqueChecks = [];

    if (emailChanged) {
      uniqueChecks.push({ email: data.email });
    }
    if (data.username !== undefined && data.username !== user.username) {
      uniqueChecks.push({ username: data.username });
    }
    if (data.phone !== undefined) {
      const nextPhone = normalizePhone(data.phone);
      uniqueChecks.push({ phone: { in: phoneVariants(nextPhone) } });
      data.phone = nextPhone;
    }
    if (
      data.referral_code !== undefined &&
      data.referral_code !== user.referral_code
    ) {
      uniqueChecks.push({ referral_code: data.referral_code });
    }
    if (
      data.no_referensi !== undefined &&
      data.no_referensi !== user.no_referensi
    ) {
      uniqueChecks.push({ no_referensi: data.no_referensi });
    }

    if (uniqueChecks.length > 0) {
      const existing = await prisma.user.findFirst({
        where: {
          user_id: { not: user_id },
          OR: uniqueChecks,
        },
        select: { user_id: true },
      });

      if (existing) {
        throw new Error(
          "Email/username/phone/referral code/no referensi sudah dipakai user lain",
        );
      }
    }

    // Email baru wajib diverifikasi ulang; token baru menggantikan token lama
    // sehingga link untuk email lama tidak lagi berlaku.
    const verification = emailChanged ? createEmailVerificationToken() : null;
    if (verification) Object.assign(data, verification.fields);

    const passwordChanged = data.password !== undefined;
    if (passwordChanged) {
      data.password_hash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
      delete data.password;
    }

    // Password yang di-reset admin mencabut semua sesi user tersebut.
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.user.update({
        where: { user_id: user_id },
        data,
      });
      if (passwordChanged) await revokeUserSessions(user_id, tx);
      return result;
    });

    if (verification) {
      await deliverEmailVerificationSafely({
        to: updated.email,
        name: updated.username,
        token: verification.token,
        expiresAt: verification.expiresAt,
      });
    }

    return updated;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function revokeUserSessionsService(user_id) {
  if (!user_id) throw new Error("user_id is required");

  const user = await prisma.user.findUnique({
    where: { user_id: user_id },
    select: { user_id: true },
  });
  if (!user) throw new Error("User not found");

  return revokeUserSessions(user_id);
}

module.exports = {
  createUserService,
  updateUserService,
  revokeUserSessionsService,
};
