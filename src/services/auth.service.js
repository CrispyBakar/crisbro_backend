const crypto = require("node:crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");
const getJwtSecret = require("../lib/jwtSecret");
const { normalizePhone, phoneVariants } = require("../lib/phoneNumber");
const { getSessionPolicy } = require("../lib/sessionPolicy");
const { sendReferralValidationEmail } = require("./email.service");
const {
  createEmailVerificationToken,
  deliverEmailVerificationSafely,
} = require("./emailVerification.service");
const { createSession, revokeUserSessions } = require("./session.service");
const { findCustomerByPhone, createCustomer } = require("./runchise.service");
const {
  generateSaleTransactionsFromRunchise,
} = require("./saleTransaction.service");
const { generateRandomUniqueCode } = require("../utils/generateReferralCode");

const INVALID_CREDENTIALS_MESSAGE =
  "Email/nomor telepon atau password salah. Bila akun Anda belum pernah diaktivasi, hubungi Admin untuk menerima tautan aktivasi.";
const DUMMY_PASSWORD_HASH =
  "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
const BCRYPT_ROUNDS = 10;

class AuthServiceError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = "AuthServiceError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

function hasUsablePassword(user) {
  return typeof user?.password_hash === "string" && user.password_hash !== "";
}

function getFazpassGatewayKey() {
  return process.env.FAZPASS_GATEWEY_KEY;
}

function buildLocalCustomerData(remoteCustomer, userId, fallbackPhone) {
  const phoneNumber =
    remoteCustomer.phone_number ?? remoteCustomer.phoneNumber ?? fallbackPhone;

  return {
    user_id: userId,
    runchise_id: remoteCustomer.id,
    runchise_location_id: remoteCustomer.owner_location_id,
    name: remoteCustomer.name,
    phone_number: phoneNumber,
    normalized_phone_number: normalizePhone(phoneNumber),
    total_point: remoteCustomer.total_point ?? 0,
    available_point: remoteCustomer.available_point ?? 0,
    created_at: new Date(remoteCustomer.created_at ?? Date.now()),
    updated_at: new Date(remoteCustomer.updated_at),
  };
}

async function getReferralRegistrationData(referralCode, runchiseCustomer) {
  if (!referralCode) return null;

  const referrer = await prisma.user.findUnique({
    where: { referral_code: referralCode },
    select: {
      user_id: true,
      referral_program: {
        select: {
          referral_id: true,
          expires_at: true,
          point_reward: true,
          point_given: true,
        },
      },
    },
  });

  if (!referrer) {
    throw new AuthServiceError(404, "Referral code tidak ditemukan");
  }

  if (!referrer.referral_program) {
    throw new AuthServiceError(
      404,
      "Tidak ditemukan program referral tersebut",
    );
  }

  if (referrer.referral_program.expires_at < new Date()) {
    throw new AuthServiceError(400, "Referral code tersebut sudah kadaluwarsa");
  }

  // Kode divalidasi lebih dulu agar kode salah/kadaluwarsa tetap ditolak.
  // Customer yang sudah ada di Runchise tidak perlu referral dan tidak ada
  // reward untuk referrer. Reward hanya diberikan untuk customer baru.
  if (runchiseCustomer) return null;

  return {
    referrerId: referrer.user_id,
    programId: referrer.referral_program.referral_id,
    pointReward: referrer.referral_program.point_reward,
    pointGiven: referrer.referral_program.point_given,
  };
}

async function registerUser(data) {
  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { phone: data.phone },
        { email: data.email },
        { username: data.username },
      ],
    },
    select: { user_id: true },
  });

  if (existing) {
    throw new AuthServiceError(400, "Phone / email / username sudah terdaftar");
  }

  let remoteCustomer = await findCustomerByPhone({ phone: data.phone });
  const referralData = await getReferralRegistrationData(
    data.referral_code,
    remoteCustomer,
  );

  // Initialize point for new member
  let pointNewMember = 0;

  if (!remoteCustomer) {
    remoteCustomer = await createCustomer({
      name: data.name,
      phone_number: data.phone,
      email: data.email,
      owner_location_id: data.location_id,
      status: "active",
    });
    pointNewMember = 1;
  }

  if (!remoteCustomer) {
    throw new AuthServiceError(502, "Gagal membuat customer di Runchise");
  }

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
  const verification = createEmailVerificationToken();
  const { user, referral } = await prisma.$transaction(async (tx) => {
    // Public registration always creates a customer account. Privileged roles
    // must be provisioned through an authenticated administrative flow.
    const createdUser = await tx.user.create({
      data: {
        username: data.username,
        email: data.email,
        phone: data.phone,
        role: "customer",
        password_hash: passwordHash,
        ...verification.fields,
      },
    });

    // Customer lokal bisa sudah ada dari sync Runchise (user_id masih null)
    // dengan format nomor berbeda, jadi dicari lewat runchise_id lalu semua
    // varian nomor. Customer yang ditemukan wajib dihubungkan ke user baru.
    const normalizedPhone = normalizePhone(data.phone);
    const customerLocal =
      (await tx.customer.findUnique({
        where: { runchise_id: remoteCustomer.id },
        select: { customer_id: true, user_id: true },
      })) ??
      (await tx.customer.findFirst({
        where: {
          OR: [
            { normalized_phone_number: normalizedPhone },
            { phone_number: { in: phoneVariants(normalizedPhone) } },
          ],
        },
        select: { customer_id: true, user_id: true },
        orderBy: { created_at: "asc" },
      }));

    if (customerLocal?.user_id) {
      throw new AuthServiceError(
        400,
        "Nomor telepon sudah terhubung dengan akun lain",
      );
    }

    const customerData = buildLocalCustomerData(
      remoteCustomer,
      createdUser.user_id,
      data.phone,
    );

    if (customerLocal) {
      const { created_at, ...linkData } = customerData;
      await tx.customer.update({
        where: { customer_id: customerLocal.customer_id },
        data: linkData,
      });
    } else {
      await tx.customer.create({ data: customerData });
    }

    let createdReferralRecord = [];
    if (referralData) {
      // For referred
      const referred = await tx.referral.create({
        data: {
          referral_program_id: referralData.programId,
          referrer_id: referralData.referrerId,
          referred_id: createdUser.user_id,
          // Referral row belongs to the newly referred user, so its stored
          // point value is the amount given to that user.
          point_awarded: referralData.pointGiven + pointNewMember,
          status: "pending",
        },
      });

      // For referrer
      const referrer = await tx.referral.create({
        data: {
          referral_program_id: referralData.programId,
          referrer_id: createdUser.user_id,
          referred_id: referralData.referrerId,
          point_awarded: referralData.pointReward,
          status: "pending",
        },
      });

      createdReferralRecord.push(referred, referrer);
    }

    const createdReferral =
      createdReferralRecord.length !== 0
        ? {
            ...createdReferralRecord,
            rewards: {
              referrer: {
                user_id: referralData.referrerId,
                point_reward: referralData.pointReward,
              },
              referred: {
                user_id: createdUser.user_id,
                point_given: referralData.pointGiven,
              },
            },
          }
        : null;

    return { user: createdUser, referral: createdReferral };
  });

  // Generate no reference for activation user
  const noRef = generateRandomUniqueCode(10);

  let code;
  let exist = true;
  while (exist) {
    code = generateRandomUniqueCode(10);
    exist = await prisma.user.findUnique({ where: { no_referensi: code } });
  }

  await prisma.user.update({
    where: { user_id: user.user_id },
    data: {
      no_referensi: code,
    },
  });

  const userWithReference = await prisma.user.update({
    where: { user_id: user.user_id },
    data: { no_referensi: code },
    select: {
      user_id: true,
      email: true,
      username: true,
      phone: true,
      role: true,
      email_verified: true,
      referral_code: true,
      no_referensi: true,
      phone_verified: true,
      status: true,
      created_at: true,
      updated_at: true,
    },
  });

  // await deliverEmailVerificationSafely({
  //   to: userWithReference.email,
  //   name: data.name,
  //   token: verification.token,
  //   expiresAt: verification.expiresAt,
  // });

  const defaultText = `AKTIVASI CRISBRO\nHarap kirim pesan ini tanpa merubah apapun.\nNo.ref:${userWithReference.no_referensi}`;

  return { user: userWithReference, referral, text: defaultText };
}

async function sendUserReferenceCode(userId) {
  if (!userId) throw new AuthServiceError(400, "user_id is required");

  const user = await prisma.user.findUnique({ where: { user_id: userId } });
  if (!user) throw new AuthServiceError(404, "User not found");

  const noRef = generateRandomUniqueCode(10);

  let code;
  let exist = true;
  while (exist) {
    code = generateRandomUniqueCode(10);
    exist = await prisma.user.findUnique({ where: { no_referensi: code } });
  }

  const userReference = await prisma.user.update({
    where: { user_id: userId },
    data: {
      no_referensi: code,
    },
  });

  const defaultText = `AKTIVASI CRISBRO\nHarap kirim pesan ini tanpa merubah apapun.\nNo.ref:${userReference.no_referensi}`;

  return { user: userReference, text: defaultText };
}

async function notifyMarketingAboutReferral(userId) {
  const referral = await prisma.referral.findFirst({
    where: { referred_id: userId, status: "pending" },
    include: { referrer: true, referred: true },
  });
  if (!referral) return;

  const recipients = await prisma.user.findMany({
    where: { role: "marketing", status: "active" },
    select: { email: true },
  });

  await Promise.allSettled(
    recipients.map(({ email }) =>
      sendReferralValidationEmail({
        to: email,
        referrer: {
          name: referral.referrer.username,
          phone: referral.referrer.phone,
        },
        referred: {
          name: referral.referred.username,
          phone: referral.referred.phone,
        },
        referralCode: referral.referrer.referral_code,
        validationUrl:
          process.env.REFERRAL_VALIDATION_URL ||
          "https://crisbro-frontend.vercel.app",
      }),
    ),
  );
}

async function verifyUserPhone({ raw_phone, noRef }) {
  if (!raw_phone) throw new AuthServiceError(400, "phone is required");
  if (!noRef) throw new AuthServiceError(400, "noRef is required");

  const phone = normalizePhone(raw_phone);

  const user = await prisma.user.findUnique({
    where: { phone: phone, no_referensi: noRef },
  });

  if (!user) throw new AuthServiceError(404, "User not found");

  if (user.status === "active")
    throw new AuthServiceError(400, "User has been activate");

  const verifiedUser = await prisma.user.update({
    where: { user_id: user.user_id },
    data: { phone_verified: true, status: "active" },
  });

  // NOTIFY TO ADMIN
  await notifyMarketingAboutReferral(user.user_id);

  // GENERATE OLD USER SALE TRANSACTION
  const customer = await prisma.customer.findUnique({
    where: { user_id: user.user_id },
    select: { customer_id: true },
  });

  try {
    await generateSaleTransactionsFromRunchise(customer?.customer_id);
  } catch (error) {
    throw new AuthServiceError(400, error.message);
  }

  return verifiedUser;
}

function parseLoginIdentity({ email: rawEmail, phone: rawPhone }) {
  const email =
    typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  const phone = normalizePhone(rawPhone);
  const isEmailLogin = email !== "";
  const isPhoneLogin = Boolean(phone);

  if (
    isEmailLogin === isPhoneLogin ||
    (isEmailLogin && !/^[^\s@]+@crisbar\.id$/i.test(email)) ||
    (isPhoneLogin && !phone.startsWith("8"))
  ) {
    throw new AuthServiceError(
      400,
      "Gunakan salah satu: nomor telepon yang diawali 8, atau email marketing @crisbar.id.",
    );
  }

  return { email, phone, isEmailLogin };
}

async function authenticateUser(
  { email, phone, password },
  { userAgent, ipAddress } = {},
) {
  if (typeof password !== "string" || password.trim() === "") {
    throw new AuthServiceError(400, "Password wajib diisi");
  }

  const identity = parseLoginIdentity({ email, phone });
  const credentials = await prisma.user.findFirst({
    where: identity.isEmailLogin
      ? {
          email: { equals: identity.email, mode: "insensitive" },
          OR: [
            {
              role: "marketing",
            },
            {
              role: "admin",
            },
          ],
        }
      : { phone: { in: phoneVariants(identity.phone) } },
    orderBy: { user_id: "asc" },
    select: { user_id: true, password_hash: true },
  });

  const canAuthenticate = hasUsablePassword(credentials);
  const validPassword = await bcrypt.compare(
    password,
    canAuthenticate ? credentials.password_hash : DUMMY_PASSWORD_HASH,
  );

  if (!canAuthenticate || !validPassword) {
    throw new AuthServiceError(401, INVALID_CREDENTIALS_MESSAGE);
  }

  const user = await prisma.user.findUnique({
    where: { user_id: credentials.user_id },
    include: { customer: true },
  });
  if (!user) throw new AuthServiceError(401, INVALID_CREDENTIALS_MESSAGE);

  const sessionPolicy = getSessionPolicy(user.role);
  // `jwtid` acak membuat setiap login menghasilkan token (dan token_hash)
  // berbeda walau dua login terjadi pada detik yang sama.
  const token = jwt.sign(
    { user_id: user.user_id, role: user.role },
    getJwtSecret(),
    { expiresIn: sessionPolicy.absoluteExpiresIn, jwtid: crypto.randomUUID() },
  );
  const decodedToken = jwt.decode(token);
  const tokenExpMs =
    decodedToken && typeof decodedToken.exp === "number"
      ? decodedToken.exp * 1000
      : Date.now() + sessionPolicy.idleMs;

  await createSession({
    userId: user.user_id,
    role: user.role,
    token,
    tokenExpMs,
    userAgent,
    ipAddress,
  });

  return {
    token,
    expiresAt: new Date(tokenExpMs),
    expiresIn: sessionPolicy.absoluteExpiresIn,
    user,
  };
}

async function getUserProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { user_id: userId },
    include: { customer: true },
  });
  if (!user) throw new AuthServiceError(404, "User tidak ditemukan");

  if (!user.customer) return { user, nextReward: null };
  return { user };
}

async function changeUserPassword(userId, currentPassword, newPassword) {
  const user = await prisma.user.findUnique({
    where: { user_id: userId },
    select: { user_id: true, password_hash: true },
  });
  if (!user) throw new AuthServiceError(404, "User tidak ditemukan");
  if (!hasUsablePassword(user)) {
    throw new AuthServiceError(409, "Akun belum memiliki password aktif");
  }

  const validPassword = await bcrypt.compare(
    currentPassword,
    user.password_hash,
  );
  if (!validPassword) throw new AuthServiceError(401, "Password lama salah");

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  // Semua sesi (termasuk sesi saat ini) dicabut bersamaan dengan pergantian
  // password, sehingga token yang mungkin bocor ikut tidak berlaku.
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { user_id: user.user_id },
      data: { password_hash: passwordHash },
    });
    await revokeUserSessions(user.user_id, tx);
  });
}

module.exports = {
  AuthServiceError,
  registerUser,
  sendUserReferenceCode,
  verifyUserPhone,
  authenticateUser,
  getUserProfile,
  changeUserPassword,
  buildLocalCustomerData,
};
