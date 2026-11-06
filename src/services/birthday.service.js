const { Prisma } = require("@prisma/client");
const prisma = require("../lib/prisma");
const { connection } = require("../lib/redis");
const { getWibDateParts, formatWibDate } = require("../lib/wibDate");
const {
  findUserSubscriptions,
  sendToSubscriptions,
} = require("./push.service");
const { deactivatePromoCode } = require("./runchise.service");

const SEND_CONCURRENCY = 10;
// Penanda "sudah dikirim" cukup hidup beberapa hari; tujuannya hanya mencegah
// ucapan ganda bila job di-retry atau dijalankan ulang manual di hari yang sama.
const SENT_MARKER_TTL_SECOND = 3 * 24 * 60 * 60;

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// Customer yang lahir 29 Februari diberi ucapan tanggal 28 Februari di tahun
// non-kabisat, supaya tidak terlewat tiga tahun sekali.
function getBirthdayDays({ year, month, day }) {
  if (month === 2 && day === 28 && !isLeapYear(year)) return [28, 29];
  return [day];
}

// Hanya customer yang punya akun app dan pernah mengizinkan notifikasi;
// sisanya tidak bisa dikirimi push sama sekali.
async function findBirthdayCustomers(now) {
  const parts = getWibDateParts(now);
  const days = getBirthdayDays(parts);

  const result = await prisma.$queryRaw`
    SELECT c.customer_id, c.user_id, c.name
    FROM "Customer" c
    INNER JOIN "User" u ON u.user_id = c.user_id
    WHERE c.dob IS NOT NULL
      AND c.created_at <= NOW() - INTERVAL '2 months'
      AND EXTRACT(MONTH FROM c.dob)::int = ${parts.month}
      AND EXTRACT(DAY FROM c.dob)::int IN (${Prisma.join(days)})
      AND EXISTS (
        SELECT 1 FROM "PushSubscription" p WHERE p.user_id = c.user_id
      )
  `;

  return result;
}

function buildBirthdayMessage(name) {
  const firstName = String(name || "")
    .trim()
    .split(/\s+/)[0];

  return {
    title: firstName
      ? `Selamat ulang tahun, ${firstName}! 🎂`
      : "Selamat ulang tahun! 🎂",
    body: "Semoga harimu menyenangkan dan penuh kebahagiaian! 🎉 Kamu mendapat voucher spesial ulang tahun, langsung claim ya di aplikasi Crisbro! 🎁",
    // Sengaja tanpa `tag`: Chrome di macOS mengganti notifikasi lama ber-tag
    // sama tanpa menampilkan banner. Duplikat sudah dicegah penanda Redis.
    url: "/",
  };
}

// Klaim atomik per device per hari, bukan per user: device yang baru subscribe
// setelah run pertama tetap kebagian ucapan saat job dijalankan ulang, sementara
// device yang sudah menerima tidak dikirimi dua kali.
async function greetDevice(subscription, message, dateLabel) {
  const markerKey = `customer-birthday:${dateLabel}:${subscription.push_subscription_id}`;
  const claimed = await connection.set(
    markerKey,
    "1",
    "EX",
    SENT_MARKER_TTL_SECOND,
    "NX",
  );
  if (!claimed) return "skipped";

  let result = null;
  try {
    // Throw hanya bila VAPID belum diisi; kegagalan per device sudah di-log push.service
    const summary = await sendToSubscriptions([subscription], message);
    if (summary.sent > 0) return "sent";
    result = summary.expired > 0 ? "expired" : "failed";
  } catch (error) {
    console.error(
      `[birthday] ucapan ke ${subscription.push_subscription_id} gagal:`,
      error.message,
    );
    result = "failed";
  }

  // Lepas klaim supaya run berikutnya di hari yang sama masih bisa mencoba lagi.
  // Subscription expired sudah dihapus, jadi tidak akan dicoba ulang.
  await connection.del(markerKey).catch(() => undefined);
  return result;
}

async function greetCustomer(customer, dateLabel) {
  const subscriptions = await findUserSubscriptions(customer.user_id);
  const message = buildBirthdayMessage(customer.name);

  return Promise.all(
    subscriptions.map((subscription) =>
      greetDevice(subscription, message, dateLabel),
    ),
  );
}

// Dijalankan worker harian: kirim ucapan ke customer yang berulang tahun hari ini (WIB).
// `customers` dihitung per customer; sent/skipped/expired/failed per device.
async function sendBirthdayGreetings({ now = new Date() } = {}) {
  const dateLabel = formatWibDate(now);
  const customers = await findBirthdayCustomers(now);
  const summary = {
    date: dateLabel,
    customers: customers.length,
    sent: 0,
    skipped: 0,
    expired: 0,
    failed: 0,
  };

  for (let i = 0; i < customers.length; i += SEND_CONCURRENCY) {
    const batch = customers.slice(i, i + SEND_CONCURRENCY);
    const results = await Promise.all(
      batch.map((customer) => greetCustomer(customer, dateLabel)),
    );
    for (const result of results.flat()) summary[result] += 1;
  }

  return summary;
}

// Simpan data dan berikan voucher untuk customer yang berulang tahun.
// Function ini mencari promo_code dengan promo_type 'birthday_promo',
// lalu membuat record di tabel UserBirthdayTreat.
async function handleBirthdayCustomer(customer) {
  const now = new Date();
  const parts = getWibDateParts(now);

  // Cari promo aktif dengan tipe birthday_promo yang memiliki promo_code tersedia (belum diklaim)
  const birthdayPromoCode = await prisma.promoCode.findFirst({
    where: {
      promo: {
        promo_type: "birthday_promo",
        status: "active",
      },
      is_claimed: false,
      status: "active",
    },
    orderBy: { created_at: "asc" }, // Ambil yang paling lama belum dipakai (FIFO)
  });

  if (!birthdayPromoCode) {
    console.error(
      `[birthday] Tidak ditemukan promo_code untuk birthday_promo. Customer: ${customer.customer_id}`,
    );
    return {
      success: false,
      error: "NO_AVAILABLE_BIRTHDAY_PROMO",
      customer_id: customer.customer_id,
    };
  }

  try {
    // Gunakan transaction untuk memastikan atomicity:
    // 1. Update promo_code menjadi claimed
    // 2. Insert record ke UserBirthdayTreat
    const result = await prisma.$transaction(async (tx) => {
      // Tandai promo_code sudah digunakan untuk birthday treat ini
      await tx.promoCode.update({
        where: { promo_code_id: birthdayPromoCode.promo_code_id },
        data: { is_claimed: true },
      });

      // Buat record birthday treat untuk customer
      const birthdayTreat = await tx.userBirthdayTreat.create({
        data: {
          customer_id: customer.customer_id,
          birthday_date: new Date(
            Date.UTC(parts.year, parts.month - 1, parts.day),
          ),
          treat_year: parts.year,
          promo_code_id: birthdayPromoCode.promo_code_id,
          status: "pending",
        },
      });

      return birthdayTreat;
    });

    console.log(
      `[birthday] Birthday treat berhasil dibuat untuk customer ${customer.customer_id}, promo_code: ${birthdayPromoCode.code ?? birthdayPromoCode.promo_code_id}`,
    );

    return {
      success: true,
      user_birthday_id: result.user_birthday_id,
      customer_id: customer.customer_id,
      promo_code_id: birthdayPromoCode.promo_code_id,
      status: result.status,
    };
  } catch (error) {
    console.error(
      `[birthday] Gagal membuat birthday treat untuk customer ${customer.customer_id}:`,
      error.message,
    );

    // Jika gagal, coba rollback status promo_code jika sudah ter-update
    try {
      await prisma.promoCode.update({
        where: { promo_code_id: birthdayPromoCode.promo_code_id },
        data: { is_claimed: false },
      });
    } catch (rollbackError) {
      console.error(
        `[birthday] Gagal rollback promo_code:`,
        rollbackError.message,
      );
    }

    return {
      success: false,
      error: "CREATE_BIRTHDAY_TREAT_FAILED",
      customer_id: customer.customer_id,
      message: error.message,
    };
  }
}

// Proses semua customer yang berulang tahun hari ini dan berikan birthday treat.
async function processBirthdayTreats({ now = new Date() } = {}) {
  const customers = await findBirthdayCustomers(now);
  const results = {
    date: formatWibDate(now),
    total_customers: customers.length,
    success: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  for (const customer of customers) {
    // Cek apakah customer sudah mendapat birthday treat untuk tahun ini
    const parts = getWibDateParts(now);
    const existingTreat = await prisma.userBirthdayTreat.findFirst({
      where: {
        customer_id: customer.customer_id,
        treat_year: parts.year,
        status: { in: ["pending", "claimed"] },
      },
    });

    if (existingTreat) {
      results.skipped++;
      results.details.push({
        customer_id: customer.customer_id,
        status: "ALREADY_HAS_TREAT",
        existing_treat_id: existingTreat.user_birthday_id,
      });
      continue;
    }

    const result = await handleBirthdayCustomer(customer);
    if (result.success) {
      results.success++;
    } else {
      results.failed++;
    }
    results.details.push(result);
  }

  return results;
}

// Expiredkan birthday treats dengan 2 kategori:
//
// 1. UNCLAIMED TIMEOUT (24 jam):
//    - Status: pending → expired_unclaimed
//    - Kondisi: created_at > 24 jam lalu
//    - Aksi: ROLLBACK promo_code.is_claimed = false (bisa dipakai customer lain)
//
// 2. REDEEM TIMEOUT (7 hari):
//    - Status: claimed → expired_redeem_timeout
//    - Kondisi: claimed_at > 7 hari lalu
//    - Aksi: Tidak ada rollback (voucher sudah di tangan customer)
//
async function expireOldBirthdayTreats({ now = new Date() } = {}) {
  const results = {
    unclaimed_expired: 0,
    redeem_expired: 0,
    errors: [],
  };

  // ─────────────────────────────────────────────────────────────
  // SKENARIO 1: Pending tapi tidak di-claim dalam 24 jam
  // ─────────────────────────────────────────────────────────────
  const claimDeadline = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  try {
    const unclaimedTreats = await prisma.userBirthdayTreat.findMany({
      where: {
        status: "pending",
        created_at: { lt: claimDeadline },
      },
      select: {
        user_birthday_id: true,
        promo_code_id: true,
        customer_id: true,
      },
    });

    // Proses satu per satu dengan transaction untuk atomicity + rollback promo_code
    for (const treat of unclaimedTreats) {
      try {
        await prisma.$transaction([
          // 1. Update status treat menjadi expired_unclaimed
          prisma.userBirthdayTreat.update({
            where: { user_birthday_id: treat.user_birthday_id },
            data: {
              status: "expired_unclaimed",
              expired_at: now,
            },
          }),
          // 2. Rollback promo_code supaya bisa dipakai customer lain
          prisma.promoCode.update({
            where: { promo_code_id: treat.promo_code_id },
            data: { is_claimed: false },
          }),
        ]);

        results.unclaimed_expired++;
        console.log(
          `[birthday] Expired UNCLAIMED: customer ${treat.customer_id}, promo_code di-rollback`,
        );
      } catch (err) {
        results.errors.push({
          type: "unclaimed",
          user_birthday_id: treat.user_birthday_id,
          error: err.message,
        });
        console.error(
          `[birthday] Gagal expire unclaimed treat ${treat.user_birthday_id}:`,
          err.message,
        );
      }
    }
  } catch (error) {
    console.error(`[birthday] Gagal fetch unclaimed treats:`, error.message);
    results.errors.push({ type: "unclaimed_fetch", error: error.message });
  }

  // ─────────────────────────────────────────────────────────────
  // SKENARIO 2: Sudah claimed tapi tidak ditukarkan dalam 7 hari
  // ─────────────────────────────────────────────────────────────
  const redeemDeadline = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  try {
    // 1. Ambi dulu treats yang akan di-expire (untuk mendapatkan promo_code_id).
    const toExpire = await prisma.userBirthdayTreat.findMany({
      where: {
        status: "claimed",
        claimed_at: { lt: redeemDeadline },
        expired_at: null,
      },
      select: {
        user_birthday_id: true,
        customer_id: true,
        promo_code_id: true,
      },
    });

    const ids = toExpire.map((t) => t.user_birthday_id);

    // 2. Update status di lokal database.
    if (ids.length > 0) {
      await prisma.userBirthdayTreat.updateMany({
        where: { user_birthday_id: { in: ids } },
        data: {
          status: "expired_redeem_timeout",
          expired_at: now,
        },
      });
    }

    // Deactivate promo_code di Runchise supaya tidak bisa dipakai lagi.
    for (const treat of toExpire) {
      if (!treat.promo_code_id) {
        console.warn(
          `[birthday] Treat ${treat.user_birthday_id} tidak memiliki promo_code_id, tidak bisa dinonaktifkan.`,
        );
        continue;
      }

      try {
        await deactivatePromoCodeById(treat.promo_code_id);
      } catch (err) {
        results.errors.push({
          type: "redeem_deactivate",
          user_birthday_id: treat.user_birthday_id,
          error: err.message,
        });
        console.error(
          `[birthday] Gagal menonaktifkan promo_code ${treat.promo_code_id} pada runchise untuk expired redeem timeout:`,
          err.message,
        );
      }
    }

    results.redeem_expired = toExpire.length;

    if (toExpire.length > 0) {
      console.log(
        `[birthday] ${toExpire.length} treats EXPIRED REDEEM TIMEOUT (lewat 7 hari dari claim date)`,
      );
    }
  } catch (error) {
    console.error(
      `[birthday] Gagal expire redeem timeout treats:`,
      error.message,
    );
    results.errors.push({ type: "redeem_expire", error: error.message });
  }

  console.log(
    `[birthday] Expire summary: ${results.unclaimed_expired} unclaimed, ${results.redeem_expired} redeem timeout, ${results.errors.length} errors`,
  );

  return {
    success: results.errors.length === 0,
    ...results,
  };
}

async function deactivatePromoCodeById(promo_code_id) {
  try {
    const promoCode = await prisma.promoCode.findUnique({
      where: { promo_code_id },
      include: {
        promo: true,
      },
    });

    const promo_id = promoCode?.promo?.promo_id;

    if (!promoCode || !promo_id) {
      console.error(
        `[birthday] Promo code dengan ID ${promo_code_id} tidak ditemukan atau tidak memiliki promo terkait.`,
      );
      return;
    }

    await prisma.promoCode.update({
      where: { promo_code_id },
      data: {
        status: "inactive",
      },
    });

    await deactivatePromoCode(promo_id, promo_code_id);
    console.log(
      `[birthday] Promo code ${promo_code_id} berhasil dinonaktifkan.`,
    );
  } catch (error) {
    console.error(
      `[birthday] Gagal menonaktifkan promo_code ${promo_code_id}:`,
      error.message,
    );
  }
}

// Cek apakah customer yang sedang login punya birthday treat yang masih bisa
// di-claim (popup claim voucher setelah login). Hanya treat berstatus "pending"
// yang layak ditampilkan; "claimed"/"expired_*" tidak lagi memunculkan popup.
async function getMyBirthdayTreat(user_id) {
  if (!user_id) throw new Error("user_id is required");

  const customer = await prisma.customer.findUnique({
    where: { user_id },
    select: { customer_id: true },
  });

  if (!customer) {
    return { has_claimable_treat: false, treat: null };
  }

  const treat = await prisma.userBirthdayTreat.findFirst({
    where: {
      customer_id: customer.customer_id,
      status: "pending",
    },
    orderBy: { created_at: "desc" },
    select: {
      user_birthday_id: true,
      birthday_date: true,
      treat_year: true,
      status: true,
      created_at: true,
      promo_code_id: true,
    },
  });

  return { has_claimable_treat: Boolean(treat), treat };
}

async function claimCustomerBirthdayTreat(user_id) {
  if (!user_id) throw new Error("user_id is required");

  const customer = await prisma.customer.findUnique({
    where: { user_id },
    select: { customer_id: true },
  });

  if (!customer) {
    throw new Error("Customer not found");
  }

  const now = new Date();

  try {
    // Update birthday treat status to claimed
    const claimedTreat = await prisma.userBirthdayTreat.update({
      where: {
        customer_id_treat_year: {
          customer_id: customer.customer_id,
          treat_year: new Date().getFullYear(),
        },
        status: "pending",
      },
      data: {
        status: "claimed",
        claimed_at: now,
      },
    });

    if (!claimedTreat) {
      throw new Error("No pending birthday treat found for this customer");
    }

    // Create a redeem transaction for the birthday treat.
    const redeemTransaction = await prisma.redeemTransaction.create({
      data: {
        promo_code_id: claimedTreat.promo_code_id,
        customer_id: customer.customer_id,
        redeemed_type: "birthday",
      },
    });

    return claimedTreat;
  } catch (error) {
    throw new Error(`Failed to claim birthday treat: ${error.message}`);
  }
}

module.exports = {
  sendBirthdayGreetings,
  getBirthdayDays,
  handleBirthdayCustomer,
  processBirthdayTreats,
  expireOldBirthdayTreats,
  getMyBirthdayTreat,
  claimCustomerBirthdayTreat,
};
