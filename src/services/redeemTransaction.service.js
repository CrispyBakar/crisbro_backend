const prisma = require("../lib/prisma");
const Prisma = require("@prisma/client");
const {
  adjustCustomerPoint,
  getListCustomerPointHistory,
} = require("./runchise.service");
const {
  withRunchiseRetry,
  isRunchiseErrorResponse,
  isAmbiguousRunchiseError,
} = require("../lib/runchiseRetry");

const DEDUCTION_CHECK_ATTEMPTS = 3;
const DEDUCTION_CHECK_DELAY_MS = 2_000;
const DEDUCTION_UNKNOWN = "RUNCHISE_DEDUCTION_UNKNOWN";

// Syarat promo code yang masih bisa diklaim customer. Dipakai juga oleh daftar
// loyalty product, supaya status "voucher tersedia" di daftar selalu sama
// dengan yang benar-benar bisa ditukar di sini.
// is_claimed hanya ada di database lokal; status ikut sync Runchise.
const CLAIMABLE_PROMO_CODE = { status: "active", is_claimed: false };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class RedeemError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = "RedeemError";
  }
}

// Membatalkan redeem yang sudah tersimpan ketika pemotongan poin di Runchise gagal.
async function cancelRedeem({
  redeem_transaction_id,
  promo_code_id,
  customer_id,
  points,
}) {
  try {
    await prisma.$transaction([
      prisma.redeemTransaction.delete({ where: { redeem_transaction_id } }),
      prisma.promoCode.update({
        where: { promo_code_id },
        data: { is_claimed: false },
      }),
      prisma.customer.update({
        where: { customer_id },
        data: {
          total_point: { increment: points },
          available_point: { increment: points },
        },
      }),
    ]);
  } catch (error) {
    console.error(
      `Gagal membatalkan redeem ${redeem_transaction_id}, perlu dicek manual`,
      error,
    );
  }
}

// Mengecek riwayat poin Runchise untuk memastikan apakah pemotongan redeem ini
// sudah tercatat. redeem_transaction_id di notes menjadi penanda uniknya.
// Hasil: true = sudah terpotong, false = belum, null = Runchise tidak bisa dicek.
async function wasPointDeducted(runchise_customer_id, redeem_transaction_id) {
  let deducted = null;

  for (let attempt = 0; attempt < DEDUCTION_CHECK_ATTEMPTS; attempt++) {
    // Beri jeda: request yang timeout bisa saja masih diproses Runchise.
    await sleep(DEDUCTION_CHECK_DELAY_MS);

    try {
      const histories = await getListCustomerPointHistory(runchise_customer_id);
      deducted = histories.some((history) =>
        history.notes?.includes(redeem_transaction_id),
      );
      if (deducted) return true;
    } catch (error) {
      console.error(
        `Gagal mengecek riwayat poin Runchise untuk redeem ${redeem_transaction_id}`,
        error,
      );
    }
  }

  return deducted;
}

// Memotong poin di Runchise tepat satu kali. adjust_point tidak idempoten,
// jadi error yang hasilnya tidak pasti (timeout, 5xx) dicek dulu ke riwayat
// poin sebelum diputuskan sukses, diulang, atau dibatalkan.
async function deductRunchisePoint({
  runchise_customer_id,
  points,
  promo_code,
  redeem_transaction_id,
}) {
  const notes = `Redeem voucher ${promo_code} #${redeem_transaction_id}`;

  await withRunchiseRetry(
    async () => {
      try {
        await adjustCustomerPoint(
          runchise_customer_id,
          points,
          "subtract",
          notes,
        );
      } catch (error) {
        if (!isAmbiguousRunchiseError(error)) throw error;

        const deducted = await wasPointDeducted(
          runchise_customer_id,
          redeem_transaction_id,
        );

        if (deducted === true) return;

        if (deducted === null) {
          throw Object.assign(
            new Error("Hasil pemotongan poin di Runchise tidak diketahui", {
              cause: error,
            }),
            { code: DEDUCTION_UNKNOWN },
          );
        }

        // Dipastikan belum terpotong: aman diulang atau dibatalkan.
        throw error;
      }
    },
    { shouldRetry: isRunchiseErrorResponse },
  );
}

async function redeemLoyaltyVoucher(user_id, loyalty_product_id) {
  try {
    const { customer, promo_code_id, result } = await prisma.$transaction(
      async (tx) => {
        // 1. Ambil data customer
        const customer = await prisma.customer.findFirst({
          where: { user_id: user_id },
        });

        // 2. Ambil data product dan voucher
        const product = await prisma.loyaltyProduct.findUnique({
          where: {
            loyalty_product_id: loyalty_product_id,
          },
          select: {
            loyalty_product_id: true,
            point_needed: true,
            max_redeem: true,
            promo: {
              select: {
                promo_id: true,
                start_date: true,
                end_date: true,
                status: true,
                PromoCode: {
                  where: CLAIMABLE_PROMO_CODE,
                  select: {
                    promo_code_id: true,
                    code: true,
                    status: true,
                  },
                },
              },
            },
          },
        });

        if (!customer) {
          throw new RedeemError(
            404,
            "CUSTOMER_NOT_FOUND",
            "Customer tidak ditemukan",
          );
        }

        if (!customer.runchise_id) {
          throw new RedeemError(
            422,
            "CUSTOMER_NOT_SYNCED",
            "Customer belum terhubung ke Runchise",
          );
        }

        if (!product) {
          throw new RedeemError(
            404,
            "LOYALTY_PRODUCT_NOT_FOUND",
            "Menu redeem tidak ditemukan",
          );
        }

        // promo_id opsional: loyalty product bisa belum dihubungkan ke promo
        if (!product.promo) {
          throw new RedeemError(
            400,
            "VOUCHER_UNAVAILABLE",
            "Voucher sudah tidak tersedia untuk menu ini",
          );
        }

        if (product.promo.status !== "active") {
          throw new RedeemError(
            410,
            "PROMO_INACTIVE",
            "Program promo ini sudah tidak berlaku",
          );
        }

        const now = new Date();

        if (product.promo.start_date && now < product.promo.start_date) {
          throw new RedeemError(
            400,
            "PROMO_NOT_STARTED",
            "Promo belum bisa dipakai sekarang",
          );
        }

        const endDate = product.promo?.end_date
          ? new Date(product.promo.end_date)
          : null;

        if (endDate && new Date() > endDate) {
          throw new RedeemError(
            400,
            "PROMO_EXPIRED",
            "Promo sudah tidak berlaku",
          );
        }

        // 2. Klaim satu promo code secara acak. Update-nya bersyarat: kalau
        // request lain lebih dulu mengklaim kode yang sama, count = 0 dan kode
        // berikutnya dicoba, sehingga satu kode tidak pernah dipakai dua customer.
        const candidates = [...product.promo.PromoCode].sort(
          () => Math.random() - 0.5,
        );

        let voucher = null;
        for (const candidate of candidates) {
          const claimed = await tx.promoCode.updateMany({
            where: {
              promo_code_id: candidate.promo_code_id,
              ...CLAIMABLE_PROMO_CODE,
            },
            data: { is_claimed: true },
          });

          if (claimed.count === 1) {
            voucher = candidate;
            break;
          }
        }

        if (!voucher) {
          throw new RedeemError(
            400,
            "VOUCHER_UNAVAILABLE",
            "Voucher sudah tidak tersedia untuk menu ini",
          );
        }

        const pointNeeded = product.point_needed;

        // 3. Booking slot
        const redeem = await tx.redeemTransaction.create({
          data: {
            customer_id: customer.customer_id,
            promo_code_id: voucher.promo_code_id,
            points_spent: pointNeeded,
          },
          select: { redeem_transaction_id: true, redeemed_at: true },
        });

        // 4. Potong poin di customer
        const deducted = await tx.customer.updateMany({
          where: {
            customer_id: customer.customer_id,
            available_point: { gte: pointNeeded },
          },
          data: {
            total_point: { decrement: pointNeeded },
            available_point: { decrement: pointNeeded },
          },
        });

        if (deducted.count === 0) {
          // throw -> seluruh transaksi rollback, termasuk klaim promo code dan RedeemTransaction
          throw new RedeemError(
            422,
            "INSUFFICIENT_POINTS",
            "Poin tidak cukup untuk klaim voucher ini",
          );
        }

        return {
          customer,
          promo_code_id: voucher.promo_code_id,
          result: {
            redeem_transaction_id: redeem.redeem_transaction_id,
            promo_code: voucher.code,
            points_spent: pointNeeded,
            // Pemotongan di atas sudah lolos syarat gte, jadi tidak bisa negatif
            remaining_points: customer.available_point - pointNeeded,
            redeemed_at: redeem.redeemed_at,
          },
        };
      },
      {
        // Read Committed (default Postgres) sudah cukup karena keamanan
        // dijamin conditional update (is_claimed, poin), bukan oleh isolation level.
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000, // tunggu koneksi dari pool
        timeout: 10_000, // batas durasi transaksi
      },
    );

    // 5. Potong poin di runchise. Dilakukan setelah commit supaya retry +
    // backoff tidak menahan transaksi database; redeem di atas hanya
    // dibatalkan kalau poin dipastikan belum terpotong di Runchise.
    try {
      await deductRunchisePoint({
        runchise_customer_id: customer.runchise_id,
        points: result.points_spent,
        promo_code: result.promo_code,
        redeem_transaction_id: result.redeem_transaction_id,
      });
    } catch (error) {
      // Runchise tidak bisa dicek sama sekali, jadi tidak diketahui apakah
      // poin sudah terpotong. Redeem dipertahankan: mengembalikan poin di
      // sini bisa membuat customer kehilangan poin di Runchise tanpa voucher.
      if (error.code === DEDUCTION_UNKNOWN) {
        console.error(
          `[redeem:unconfirmed] Redeem ${result.redeem_transaction_id} (customer Runchise ${customer.runchise_id}, ${result.points_spent} poin) belum terkonfirmasi terpotong di Runchise, perlu dicek manual`,
          error,
        );
        return result;
      }

      await cancelRedeem({
        redeem_transaction_id: result.redeem_transaction_id,
        promo_code_id,
        customer_id: customer.customer_id,
        points: result.points_spent,
      });
      throw error;
    }

    return result;
  } catch (error) {
    if (error instanceof Prisma.Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        throw new RedeemError(
          409,
          "ALREADY_REDEEMED",
          "Voucher ini sudah pernah kamu klaim",
        );
      }

      if (error.code === "P2003") {
        throw new RedeemError(
          404,
          "NOT_FOUND",
          "Customer atau voucher tidak ditemukan",
        );
      }
    }

    throw error;
  }
}

const REDEEMED_PRODUCT_SELECT = {
  product_id: true,
  name: true,
  sku: true,
  description: true,
  image_url: true,
};

const REDEEMER_SELECT = {
  customer_id: true,
  name: true,
  phone_number: true,
  phone_number_country_code: true,
  user: { select: { email: true } },
};

// terms_conditions dan location_ids (outlet tempat voucher berlaku) bisa
// panjang, jadi hanya ikut di detail. Data customer hanya untuk
// admin/marketing: customer sudah pasti melihat miliknya sendiri.
function redeemedVoucherSelect({ detail = false, withCustomer = false } = {}) {
  return {
    redeem_transaction_id: true,
    points_spent: true,
    redeemed_at: true,
    promoCode: {
      select: {
        promo_code_id: true,
        code: true,
        status: true,
        maximum_usage: true,
        number_of_usage: true,
        last_usage: true,
        promo: {
          select: {
            promo_id: true,
            name: true,
            status: true,
            start_date: true,
            end_date: true,
            product_ids: true,
            ...(detail ? { terms_conditions: true, location_ids: true } : {}),
          },
        },
      },
    },
    ...(withCustomer ? { customer: { select: REDEEMER_SELECT } } : {}),
  };
}

// RedeemTransaction tidak menyimpan produknya; produk diambil dari
// product_ids promo, sama seperti detail promo. Satu query untuk semua baris.
async function withRedeemedProducts(rows) {
  const productIds = [
    ...new Set(rows.flatMap((row) => row.promoCode.promo.product_ids)),
  ];
  const products = productIds.length
    ? await prisma.products.findMany({
        where: { product_id: { in: productIds } },
        select: REDEEMED_PRODUCT_SELECT,
      })
    : [];
  const byId = new Map(
    products.map((product) => [product.product_id, product]),
  );

  return rows.map(({ promoCode, customer, ...redeem }) => {
    const { promo, ...promo_code } = promoCode;
    const { product_ids, ...promoInfo } = promo;
    const { user, ...redeemer } = customer ?? {};

    return {
      ...redeem,
      promo_code,
      promo: promoInfo,
      products: product_ids.map((id) => byId.get(id)).filter(Boolean),
      ...(customer
        ? { customer: { ...redeemer, email: user?.email ?? null } }
        : {}),
    };
  });
}

async function findRedeemedVouchers(where, { page, limit, sort_order }, select) {
  const [rows, total] = await prisma.$transaction([
    prisma.redeemTransaction.findMany({
      where,
      select,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [
        { redeemed_at: sort_order },
        { redeem_transaction_id: "asc" },
      ],
    }),
    prisma.redeemTransaction.count({ where }),
  ]);

  return {
    data: await withRedeemedProducts(rows),
    meta: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

async function findRedeemedVoucher(where, select) {
  const row = await prisma.redeemTransaction.findFirst({ where, select });

  if (!row) {
    throw new RedeemError(
      404,
      "REDEEM_TRANSACTION_NOT_FOUND",
      "Voucher tidak ditemukan",
    );
  }

  const [voucher] = await withRedeemedProducts([row]);
  return voucher;
}

// Filter milik customer yang sedang login. user_id kosong harus ditolak:
// Prisma mengabaikan filter undefined, sehingga voucher semua customer akan
// ikut terbaca.
function ownedBy(user_id) {
  if (!user_id) {
    throw new RedeemError(401, "UNAUTHENTICATED", "Unauthorized");
  }
  return { customer: { user_id } };
}

async function listMyRedeemedVouchers(user_id, pagination) {
  return findRedeemedVouchers(
    ownedBy(user_id),
    pagination,
    redeemedVoucherSelect(),
  );
}

// Voucher milik customer lain dijawab 404, sama seperti voucher yang tidak ada.
async function getMyRedeemedVoucher(user_id, redeem_transaction_id) {
  return findRedeemedVoucher(
    { redeem_transaction_id, ...ownedBy(user_id) },
    redeemedVoucherSelect({ detail: true }),
  );
}

async function listRedeemedVouchers({
  search,
  customer_id,
  promo_id,
  ...pagination
}) {
  const where = {};

  if (customer_id) where.customer_id = customer_id;
  if (promo_id) where.promoCode = { promo_id };
  if (search) {
    where.OR = [
      { customer: { name: { contains: search, mode: "insensitive" } } },
      { customer: { phone_number: { contains: search } } },
      { promoCode: { code: { contains: search, mode: "insensitive" } } },
      {
        promoCode: {
          promo: { name: { contains: search, mode: "insensitive" } },
        },
      },
    ];
  }

  return findRedeemedVouchers(
    where,
    pagination,
    redeemedVoucherSelect({ withCustomer: true }),
  );
}

async function getRedeemedVoucher(redeem_transaction_id) {
  return findRedeemedVoucher(
    { redeem_transaction_id },
    redeemedVoucherSelect({ detail: true, withCustomer: true }),
  );
}

module.exports = {
  redeemLoyaltyVoucher,
  listMyRedeemedVouchers,
  getMyRedeemedVoucher,
  listRedeemedVouchers,
  getRedeemedVoucher,
  RedeemError,
  CLAIMABLE_PROMO_CODE,
};
