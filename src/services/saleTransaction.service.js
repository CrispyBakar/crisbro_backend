const prisma = require("../lib/prisma");
const { withDbRetry } = require("../lib/dbRetry");
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
    total_point: toNullableInt(transaction.total_point),
    earned_point: toNullableInt(transaction.earned_point),
    redeemed_point: toNullableString(transaction.redeemed_point),
    available_point: toNullableInt(transaction.available_point),
    products: toProducts(transaction.sale_detail_transactions),
    subtotal: toNullableFloat(transaction.subtotal),
    net_sales_after_tax: toNullableFloat(transaction.net_sales_after_tax),
    sales_time: transaction.sales_time
      ? new Date(transaction.sales_time)
      : null,
    note: transaction.note ?? null,
    applied_promos_redeemed_point: toNullableInt(
      transaction.applied_promos_redeemed_point,
    ),
    loyalty_discount_fee: toNullableFloat(transaction.loyalty_discount_fee),
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

// Menarik sale transaction seluruh customer yang sudah tersinkon Runchise
// sekaligus. Dioptimalkan untuk jumlah customer besar:
// - referensi lokasi dan id transaksi yang sudah tersimpan di-preload satu
//   kali ke Map/Set, bukan di-query per customer;
// - transaksi yang sudah tersimpan tidak ditarik ulang detailnya dari
//   Runchise (detil transaksi adalah snapshot saat penjualan);
// - panggilan API Runchise dijalankan konkuren dengan p-limit (pola yang
//   sama dengan jobs/customer-sync);
// - penulisan database di-batch per chunk dalam satu transaksi.
// Kegagalan satu customer (mis. API Runchise timeout) tidak menghentikan
// customer lain; hasil tiap customer diagregasi menjadi satu ringkasan.
// Dipakai endpoint admin.
async function generateAllSaleTransactionsFromRunchise() {
  try {
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

    // Lookup lokasi dan id transaksi tersimpan dalam bentuk Map/Set agar
    // pengecekan per transaksi tidak menambah roundtrip database. Key
    // dinormalisasi ke Number karena Runchise mengirim angka sebagai string.
    const locationByRunchiseId = new Map(
      locations
        .filter((location) => location.runchise_id !== null)
        .map((location) => [location.runchise_id, location]),
    );
    const syncedRunchiseIds = new Set(
      existingTransactions.map((transaction) => transaction.runchise_id),
    );

    const { default: pLimit } = await import("p-limit");
    const httpLimit = pLimit(5); // maksimal 5 request paralel ke API Runchise
    const customerLimit = pLimit(3); // customer diproses 3 sekaligus
    const UPSERT_CHUNK_SIZE = 50;

    const summary = {
      total_customers: customers.length,
      processed: 0,
      failed: 0,
      total_fetched: 0,
      upserted: 0,
      skipped_missing_runchise_id: 0,
      skipped_location_not_found: 0,
      skipped_already_synced: 0,
      errors: [],
    };

    await Promise.all(
      customers.map((customer) =>
        customerLimit(async () => {
          try {
            const summaries = await httpLimit(() =>
              listSaleTransactionByCustomerId(customer.runchise_id),
            );

            summary.total_fetched += summaries.length;

            const rows = [];
            for (const trx of summaries) {
              // id transaksi dipakai sebagai unique key upsert; tanpa itu
              // baris tidak bisa disimpan secara idempoten.
              if (!trx.id || !Number.isFinite(Number(trx.id))) {
                summary.skipped_missing_runchise_id += 1;
                console.warn(
                  `Transaction without runchise id (sales_no: ${trx.sales_no}), skip`,
                );
                continue;
              }

              // Detail transaksi adalah snapshot saat penjualan, jadi
              // transaksi yang sudah tersimpan tidak ditarik ulang. Inilah
              // yang membuat run berikutnya jauh lebih cepat.
              if (syncedRunchiseIds.has(trx.id)) {
                summary.skipped_already_synced += 1;
                continue;
              }

              const transaction = await httpLimit(() =>
                getDetailSaleTransaction(trx.id),
              );

              const location = locationByRunchiseId.get(
                Number(transaction.location_id),
              );

              if (!location) {
                summary.skipped_location_not_found += 1;
                console.warn(
                  `Location not found for runchise_id: ${transaction.location_id}, skip transaction ${transaction.id}`,
                );
                continue;
              }

              rows.push(
                buildSaleTransactionData(customer, location, transaction),
              );
            }

            // Penulisan di-batch per chunk dalam satu transaksi (dengan retry
            // untuk error koneksi transien) agar tidak satu roundtrip
            // database per baris. Upsert by runchise_id membuat chunk aman
            // diulang.
            for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
              const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
              await withDbRetry(() =>
                prisma.$transaction(
                  chunk.map((data) =>
                    prisma.saleTransaction.upsert({
                      where: { runchise_id: data.runchise_id },
                      create: data,
                      update: data,
                    }),
                  ),
                  { timeout: 30_000 },
                ),
              );

              for (const data of chunk) syncedRunchiseIds.add(data.runchise_id);
            }

            summary.upserted += rows.length;
            summary.processed += 1;
          } catch (error) {
            summary.failed += 1;
            summary.errors.push({
              customer_id: customer.customer_id,
              message: error.message,
            });
          }
        }),
      ),
    );

    return summary;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
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
  listSaleTransactionsByCustomerId,
};
