const axios = require("axios");
const { Prisma } = require("@prisma/client");
const prisma = require("../lib/prisma");
const { withDbRetry } = require("../lib/dbRetry");
const {
  withDistributedCronLock,
  RUNCHISE_CRON_LOCK_IDS,
} = require("../lib/distributedCronLock");
const {
  listSaleTransactionByCustomerId,
  getDetailSaleTransaction,
} = require("./runchise.service");

// Runchise API mengirim angka sebagai string (mis. "34400.0") dan
// terkadang mengirim string kosong untuk nilai yang kosong.
function toNullableInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function toNullableFloat(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
}

function toNullableString(value) {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

// Response Runchise menyimpan daftar produk per entry send_order_users
// (per kasir), jadi semua produk digabung menjadi satu array.
function toProducts(sale_detail_transactions) {
  if (!Array.isArray(sale_detail_transactions)) return null;
  const products = sale_detail_transactions.flatMap(
    (transaction) => transaction.product_id,
  );
  return products.length > 0 ? products : null;
}

// Satu customer biasanya bertransaksi di sedikit outlet, jadi lookup lokasi
// di-cache per proses generate agar tidak mem-query Location untuk setiap
// transaksi.
function createLocationCache() {
  const cache = new Map();

  return {
    async findByRunchiseId(runchiseLocationId) {
      if (cache.has(runchiseLocationId)) return cache.get(runchiseLocationId);

      const location = await prisma.location.findFirst({
        where: { runchise_id: runchiseLocationId },
      });
      cache.set(runchiseLocationId, location);
      return location;
    },
  };
}

// Data poin loyalty dikirim Runchise di dalam `metadata`, bukan di level
// atas transaksi. Transaksi tanpa program loyalty (mis. order Shopee
// Integrasi) tidak memiliki field ini sama sekali sehingga tersimpan NULL.
function toPointData(transaction) {
  const metadata = transaction.metadata ?? {};
  return {
    // metadata.loyalty hanya ada bila transaksi mengikuti program loyalty.
    point_from_transaction: toNullableInt(metadata.loyalty?.point),
    total_point: toNullableInt(metadata.total_point),
    earned_point: toNullableInt(metadata.earned_point),
    redeemed_point: toNullableString(metadata.redeemed_point),
    available_point: toNullableInt(metadata.available_point),
  };
}

function buildSaleTransactionData(customer, location, transaction) {
  return {
    customer_id: customer.customer_id,
    location_id: location.location_id,
    runchise_id: Number(transaction.id),
    runchise_brand_id: toNullableInt(transaction.brand_id),
    runchise_sales_no: toNullableString(transaction.sales_no),
    runchise_customer_id: toNullableInt(transaction.customer_id),
    runchise_location_id: toNullableInt(transaction.location_id),
    gross_sales: toNullableFloat(transaction.gross_sales),
    net_sales: toNullableFloat(transaction.net_sales),
    location_name: transaction.location_name ?? null,
    order_type_name: transaction.order_type_name ?? null,
    ...toPointData(transaction),
    // Kolom Json nullable tidak menerima literal null; Prisma mewajibkan
    // DbNull untuk menyimpan NULL SQL.
    products: toProducts(transaction.sale_detail_transactions) ?? Prisma.DbNull,
    subtotal: toNullableFloat(transaction.subtotal),
    net_sales_after_tax: toNullableFloat(transaction.net_sales_after_tax),
    sales_time: transaction.sales_time
      ? new Date(transaction.sales_time)
      : null,
    note: transaction.note ?? null,
    // Kolom bertipe TEXT sejak migration 20260923074814_revisi.
    applied_promos_redeemed_point: toNullableString(
      transaction.applied_promos_redeemed_point,
    ),
    // Kolom bertipe TEXT sejak migration 20260925034037_modifiy_sale_transaction.
    loyalty_discount_fee: toNullableString(transaction.loyalty_discount_fee),
  };
}

// Menarik seluruh sale transaction milik seorang customer dari Runchise lalu
// menyimpannya (upsert by runchise_id) ke tabel SaleTransaction lokal.
// Dipakai endpoint admin dan proses aktivasi user lama di auth.service.
async function generateSaleTransactionsFromRunchise(customer_id) {
  if (!customer_id) throw new Error("customer_id is required");

  const customer = await prisma.customer.findUnique({
    where: { customer_id },
    select: { customer_id: true, runchise_id: true, name: true },
  });

  if (!customer) throw new Error("Customer tidak ditemukan");

  if (!customer.runchise_id) {
    throw new Error(
      "Customer belum tersinkron dengan Runchise (runchise_id kosong)",
    );
  }

  const transactionsSummary = await listSaleTransactionByCustomerId(
    customer.runchise_id,
  );

  const runchise_transactions_ids = transactionsSummary.map((tr) => tr.id);

  const transactions = [];
  for (const index in runchise_transactions_ids) {
    const result = await getDetailSaleTransaction(
      runchise_transactions_ids[index],
    );
    transactions.push(result);
  }

  const locationCache = createLocationCache();
  const summary = {
    customer_id: customer.customer_id,
    runchise_customer_id: customer.runchise_id,
    total_fetched: transactions.length,
    upserted: 0,
    skipped_missing_runchise_id: 0,
    skipped_location_not_found: 0,
  };

  for (const transaction of transactions) {
    // id transaksi dipakai sebagai unique key upsert; tanpa itu baris tidak
    // bisa disimpan secara idempoten.
    if (!transaction.id || !Number.isFinite(Number(transaction.id))) {
      summary.skipped_missing_runchise_id += 1;
      console.warn(
        `Transaction without runchise id (sales_no: ${transaction.sales_no}), skip`,
      );
      continue;
    }

    const location = await locationCache.findByRunchiseId(
      transaction.location_id,
    );

    if (!location) {
      summary.skipped_location_not_found += 1;
      console.warn(
        `Location not found for runchise_id: ${transaction.location_id}, skip transaction ${transaction.id}`,
      );
      continue;
    }

    const data = buildSaleTransactionData(customer, location, transaction);

    await prisma.saleTransaction.upsert({
      where: { runchise_id: data.runchise_id },
      create: data,
      update: data,
    });

    summary.upserted += 1;
  }

  return summary;
}

// Batas beban ke API Runchise dan database untuk generate seluruh customer.
// RUNCHISE_HTTP_CONCURRENCY adalah batas keras request paralel ke Runchise
// (sama dengan jobs/customer-sync); CUSTOMER_CONCURRENCY hanya menentukan
// berapa customer yang antreannya diisi sekaligus agar slot HTTP selalu penuh.
const RUNCHISE_HTTP_CONCURRENCY = 5;
const CUSTOMER_CONCURRENCY = 5;
const INSERT_CHUNK_SIZE = 200;
const RUNCHISE_MAX_RETRIES = 3;
const RUNCHISE_RETRY_BASE_DELAY_MS = 1_000;
const RUNCHISE_RETRY_MAX_DELAY_MS = 30_000;
// Ringkasan dikirim sebagai response HTTP; daftar error dibatasi agar tidak
// membengkak saat Runchise down dan ribuan customer gagal.
const MAX_REPORTED_ERRORS = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// getDetailSaleTransaction membungkus AxiosError ke dalam `cause`, sedangkan
// listSaleTransactionByCustomerId melempar AxiosError apa adanya.
function getAxiosError(error) {
  if (axios.isAxiosError(error)) return error;
  if (axios.isAxiosError(error?.cause)) return error.cause;
  return null;
}

// Hanya error jaringan/timeout, 429, dan 5xx yang layak diulang; 4xx lain
// (mis. transaksi tidak ditemukan) akan gagal lagi dengan hasil yang sama.
function isTransientRunchiseError(error) {
  const axiosError = getAxiosError(error);
  if (!axiosError) return false;
  const status = axiosError.response?.status;
  return status === undefined || status === 429 || status >= 500;
}

function getRetryDelayMs(error, attempt) {
  const retryAfterSeconds = Number(
    getAxiosError(error)?.response?.headers?.["retry-after"],
  );
  const backoff = RUNCHISE_RETRY_BASE_DELAY_MS * 2 ** attempt;
  const delay = Number.isFinite(retryAfterSeconds)
    ? Math.max(backoff, retryAfterSeconds * 1_000)
    : backoff;
  return Math.min(delay, RUNCHISE_RETRY_MAX_DELAY_MS);
}

async function withRunchiseRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= RUNCHISE_MAX_RETRIES || !isTransientRunchiseError(error)) {
        throw error;
      }
      await sleep(getRetryDelayMs(error, attempt));
    }
  }
}

function recordError(summary, entry) {
  if (summary.errors.length < MAX_REPORTED_ERRORS) {
    summary.errors.push(entry);
  } else {
    summary.errors_truncated += 1;
  }
}

async function syncSaleTransactionsForCustomer(customer, context) {
  const { summary, runchiseRequest, locationByRunchiseId, knownRunchiseIds } =
    context;

  const summaries = await runchiseRequest(() =>
    listSaleTransactionByCustomerId(customer.runchise_id),
  );
  summary.total_fetched += summaries.length;

  const pendingIds = [];
  for (const trx of summaries) {
    // Runchise dapat mengirim id sebagai string, sedangkan kolom runchise_id
    // bertipe Int; tanpa normalisasi, pengecekan Set di bawah tidak pernah
    // cocok dan seluruh detail ditarik ulang setiap run.
    const runchiseId = Number(trx.id);

    // id transaksi dipakai sebagai unique key; tanpa itu baris tidak bisa
    // disimpan secara idempoten.
    if (!trx.id || !Number.isInteger(runchiseId)) {
      summary.skipped_missing_runchise_id += 1;
      console.warn(
        `Transaction without runchise id (sales_no: ${trx.sales_no}), skip`,
      );
      continue;
    }

    // Detail transaksi adalah snapshot saat penjualan, jadi transaksi yang
    // sudah tersimpan tidak ditarik ulang. Id langsung ditandai agar
    // duplikat di run yang sama tidak di-fetch dua kali; bila fetch-nya
    // gagal, run berikutnya akan mencobanya lagi karena Set dibangun ulang
    // dari database.
    if (knownRunchiseIds.has(runchiseId)) {
      summary.skipped_already_synced += 1;
      continue;
    }
    knownRunchiseIds.add(runchiseId);
    pendingIds.push(runchiseId);
  }

  // Seluruh detail customer ini dimasukkan ke antrean sekaligus; jumlah
  // request yang benar-benar berjalan tetap dibatasi runchiseRequest.
  // allSettled memastikan satu detail yang gagal tidak membuang detail lain
  // yang sudah berhasil ditarik.
  const results = await Promise.allSettled(
    pendingIds.map((id) => runchiseRequest(() => getDetailSaleTransaction(id))),
  );

  const rows = [];
  results.forEach((result, index) => {
    const runchiseId = pendingIds[index];

    if (result.status === "rejected" || !result.value) {
      summary.failed_transactions += 1;
      recordError(summary, {
        customer_id: customer.customer_id,
        runchise_transaction_id: runchiseId,
        message:
          result.status === "rejected"
            ? result.reason?.message
            : "Detail transaksi kosong dari Runchise",
      });
      return;
    }

    const transaction = result.value;
    const location = locationByRunchiseId.get(Number(transaction.location_id));

    if (!location) {
      summary.skipped_location_not_found += 1;
      console.warn(
        `Location not found for runchise_id: ${transaction.location_id}, skip transaction ${transaction.id}`,
      );
      return;
    }

    rows.push(buildSaleTransactionData(customer, location, transaction));
  });

  // Semua baris di sini belum ada di database, jadi cukup satu INSERT per
  // chunk. skipDuplicates menjaga idempotensi bila baris yang sama sempat
  // disimpan proses lain (mis. worker customer-sync) di tengah run.
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
    const { count } = await withDbRetry(() =>
      prisma.saleTransaction.createMany({ data: chunk, skipDuplicates: true }),
    );

    summary.inserted += count;
    summary.skipped_duplicate += chunk.length - count;
  }
}

async function runGenerateAllSaleTransactions() {
  const startedAt = Date.now();

  const [customers, locations, existingTransactions] = await Promise.all([
    prisma.customer.findMany({
      where: { runchise_id: { not: null } },
      select: { customer_id: true, runchise_id: true },
    }),
    prisma.location.findMany({
      select: { location_id: true, runchise_id: true },
    }),
    prisma.saleTransaction.findMany({
      where: { runchise_id: { not: null } },
      select: { runchise_id: true },
    }),
  ]);

  const { default: pLimit } = await import("p-limit");
  const httpLimit = pLimit(RUNCHISE_HTTP_CONCURRENCY);
  const customerLimit = pLimit(CUSTOMER_CONCURRENCY);

  const context = {
    summary: {
      total_customers: customers.length,
      processed_customers: 0,
      failed_customers: 0,
      total_fetched: 0,
      inserted: 0,
      failed_transactions: 0,
      skipped_missing_runchise_id: 0,
      skipped_location_not_found: 0,
      skipped_already_synced: 0,
      skipped_duplicate: 0,
      duration_ms: 0,
      errors: [],
      errors_truncated: 0,
    },
    // Retry dijalankan di dalam slot limiter: saat Runchise membalas 429,
    // backoff ikut menahan slot sehingga beban ke Runchise benar-benar turun.
    runchiseRequest: (fn) => httpLimit(() => withRunchiseRetry(fn)),
    // Lookup lokasi dan id transaksi tersimpan dalam bentuk Map/Set agar
    // pengecekan per transaksi tidak menambah roundtrip database.
    locationByRunchiseId: new Map(
      locations
        .filter((location) => location.runchise_id !== null)
        .map((location) => [location.runchise_id, location]),
    ),
    knownRunchiseIds: new Set(
      existingTransactions.map((transaction) => transaction.runchise_id),
    ),
  };
  const { summary } = context;

  await Promise.all(
    customers.map((customer) =>
      customerLimit(async () => {
        try {
          await syncSaleTransactionsForCustomer(customer, context);
          summary.processed_customers += 1;
        } catch (error) {
          summary.failed_customers += 1;
          recordError(summary, {
            customer_id: customer.customer_id,
            message: error.message,
          });
        }
      }),
    ),
  );

  summary.duration_ms = Date.now() - startedAt;
  return summary;
}

// Menarik sale transaction seluruh customer yang sudah tersinkron Runchise
// sekaligus. Dioptimalkan untuk jumlah customer besar:
// - referensi lokasi dan id transaksi yang sudah tersimpan di-preload satu
//   kali ke Map/Set, bukan di-query per customer;
// - transaksi yang sudah tersimpan tidak ditarik ulang detailnya dari
//   Runchise (detail transaksi adalah snapshot saat penjualan);
// - detail transaksi ditarik paralel dengan batas global
//   RUNCHISE_HTTP_CONCURRENCY, dengan retry + backoff untuk error transien;
// - baris baru disimpan dengan createMany per chunk.
// Kegagalan satu transaksi atau satu customer tidak menghentikan yang lain.
// Dijaga advisory lock sehingga hanya satu run yang aktif lintas instance;
// run kedua langsung mengembalikan { skipped: true }.
// Dipakai endpoint admin.
async function generateAllSaleTransactionsFromRunchise() {
  return withDistributedCronLock({
    jobName: "sale-transactions-generate-all",
    lockId: RUNCHISE_CRON_LOCK_IDS.saleTransactionsGenerateAll,
    run: runGenerateAllSaleTransactions,
  });
}

// Mengisi ulang kolom poin transaksi yang tersimpan sebelum mapping poin
// membaca dari `metadata`. Poin tidak tersimpan di mana pun secara lokal,
// jadi detail transaksi ditarik ulang dari Runchise. Hanya kolom poin yang
// di-update; transaksi tanpa data loyalty (mis. Shopee Integrasi) dibiarkan
// NULL. `limit` membatasi jumlah baris untuk uji coba bertahap.
async function backfillSaleTransactionPoints({ dryRun = false, limit } = {}) {
  const startedAt = Date.now();

  const rows = await prisma.saleTransaction.findMany({
    where: {
      runchise_id: { not: null },
      OR: [{ total_point: null }, { point_from_transaction: null }],
    },
    select: { transaction_id: true, runchise_id: true },
    orderBy: { sales_time: "desc" },
    ...(limit ? { take: Number(limit) } : {}),
  });

  const summary = {
    dry_run: dryRun,
    total_candidates: rows.length,
    updated: 0,
    skipped_no_loyalty_data: 0,
    failed_transactions: 0,
    duration_ms: 0,
    errors: [],
    errors_truncated: 0,
  };

  if (dryRun) {
    summary.duration_ms = Date.now() - startedAt;
    return summary;
  }

  const { default: pLimit } = await import("p-limit");
  const httpLimit = pLimit(RUNCHISE_HTTP_CONCURRENCY);

  await Promise.all(
    rows.map((row) =>
      httpLimit(async () => {
        try {
          const transaction = await withRunchiseRetry(() =>
            getDetailSaleTransaction(row.runchise_id),
          );
          const points = toPointData(transaction ?? {});

          if (Object.values(points).every((value) => value === null)) {
            summary.skipped_no_loyalty_data += 1;
            return;
          }

          await withDbRetry(() =>
            prisma.saleTransaction.update({
              where: { transaction_id: row.transaction_id },
              data: points,
            }),
          );
          summary.updated += 1;
        } catch (error) {
          summary.failed_transactions += 1;
          recordError(summary, {
            transaction_id: row.transaction_id,
            runchise_transaction_id: row.runchise_id,
            message: error.message,
          });
        }
      }),
    ),
  );

  summary.duration_ms = Date.now() - startedAt;
  return summary;
}

// Daftar transaksi penjualan milik satu customer dari tabel lokal (hasil
// sinkronisasi Runchise), paginated dengan filter outlet dan sorting.
async function listSaleTransactionsByCustomerId(customer_id, query = {}) {
  if (!customer_id) throw new Error("customer_id is required");

  const {
    page = 1,
    limit = 10,
    location_id,
    sort_by = "sales_time",
    sort_order = "desc",
  } = query;

  const skip = (Number(page) - 1) * Number(limit);
  const take = Number(limit);

  const where = { customer_id };
  if (location_id) {
    where.location_id = location_id;
  }

  try {
    const [transactions, total] = await prisma.$transaction([
      prisma.saleTransaction.findMany({
        where,
        skip,
        take,
        orderBy: { [sort_by]: sort_order },
      }),
      prisma.saleTransaction.count({ where }),
    ]);

    return {
      data: transactions,
      meta: {
        page: Number(page),
        limit: Number(limit),
        total,
        total_pages: Math.ceil(total / Number(limit)),
      },
    };
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

module.exports = {
  generateSaleTransactionsFromRunchise,
  generateAllSaleTransactionsFromRunchise,
  backfillSaleTransactionPoints,
  listSaleTransactionsByCustomerId,
};
