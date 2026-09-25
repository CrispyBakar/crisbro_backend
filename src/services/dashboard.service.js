const prisma = require("../lib/prisma");
const {
  ALL_TIME_PERIOD,
  getDashboardPeriodRange,
} = require("../lib/dashboardPeriod");
const { formatWibDate } = require("../lib/wibDate");

// Kolom sales_time bertipe TIMESTAMP tanpa zona yang berisi waktu UTC (default
// Prisma). Instant dikirim sebagai string ISO lalu di-cast ::timestamp; offset
// 'Z' diabaikan Postgres sehingga yang dibandingkan adalah jam dinding UTC,
// tidak terpengaruh setting TimeZone session database.
const toSqlTimestamp = (date) => date.toISOString();

async function getTotalCounts() {
  try {
    // Customers count (hanya yang punya outlet terdaftar, konsisten dengan
    // chart customer per outlet)
    const week_ago = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [cs_current_value, cs_last_week_value] = await prisma.$transaction([
      prisma.customer.count({
        where: {
          owner_location_id: { not: null },
        },
      }),
      prisma.customer.count({
        where: {
          owner_location_id: { not: null },
          created_at: { lte: week_ago },
        },
      }),
    ]);

    // Total Redeemed Point
    const [rp_current_value, rp_last_week_value] = await prisma.$transaction([
      prisma.saleTransaction.count({
        where: {
          AND: [
            { redeemed_point: { not: null } },
            { redeemed_point: { not: "0" } },
            { redeemed_point: { not: "0.0" } },
          ],
        },
      }),
      prisma.saleTransaction.count({
        where: {
          AND: [
            { redeemed_point: { not: null } },
            { redeemed_point: { not: "0" } },
            { redeemed_point: { not: "0.0" } },
            { sales_time: { lte: week_ago } },
          ],
        },
      }),
    ]);

    // Total Point Member
    const [mp_current, mp_last_week] = await prisma.$transaction([
      prisma.customer.aggregate({ _sum: { available_point: true } }),
      prisma.customer.aggregate({
        _sum: { available_point: true },
        where: {
          created_at: { lte: week_ago },
        },
      }),
    ]);
    const mp_current_value = mp_current._sum.available_point ?? 0;
    const mp_last_week_value = mp_last_week._sum.available_point ?? 0;

    // Total Product Loyalty
    const [lp_current_value, lp_last_week_value] = await prisma.$transaction([
      prisma.loyaltyProduct.count(),
      prisma.loyaltyProduct.count({
        where: {
          created_at: { lte: week_ago },
        },
      }),
    ]);

    return {
      customers: {
        current_value: cs_current_value,
        last_week_value: cs_last_week_value,
      },
      redeemed_points: {
        current_value: rp_current_value,
        last_week_value: rp_last_week_value,
      },
      member_points: {
        current_value: mp_current_value,
        last_week_value: mp_last_week_value,
      },
      loyalty_products: {
        current_value: lp_current_value,
        last_week_value: lp_last_week_value,
      },
    };
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

// Customer dikelompokkan menurut outlet terdaftarnya (owner_location_id).
// `createdAt` (filter Prisma) membatasi ke customer yang mendaftar pada
// rentang tersebut; created_at diisi dari tanggal daftar di Runchise saat
// sync, bukan waktu sync. undefined = tanpa filter tanggal.
const countCustomersByOutlet = (createdAt) =>
  prisma.customer.groupBy({
    by: ["owner_location_id"],
    where: { owner_location_id: { not: null }, created_at: createdAt },
    _count: { _all: true },
  });

const toCountMap = (groups) =>
  new Map(groups.map((group) => [group.owner_location_id, group._count._all]));

// Semua Location ikut dikembalikan (customer 0 tetap tampil) karena chart
// punya pencarian dan urutan "Tersedikit". `previous` null = tanpa pembanding.
function buildOutlets(locations, current, previous) {
  return locations
    .map((location) => ({
      location_id: location.location_id,
      location_name: location.name,
      customers: current.get(location.location_id) ?? 0,
      previous_customers: previous
        ? (previous.get(location.location_id) ?? 0)
        : null,
    }))
    .sort(
      (a, b) =>
        b.customers - a.customers ||
        a.location_name.localeCompare(b.location_name),
    );
}

// Tiap customer hanya punya satu owner_location_id, jadi total = jumlah per
// outlet (tidak ada dobel hitung).
const sumBy = (outlets, key) =>
  outlets.reduce((sum, outlet) => sum + outlet[key], 0);

const findLocations = () =>
  prisma.location.findMany({ select: { location_id: true, name: true } });

// Seluruh customer per outlet tanpa filter tanggal. Tidak ada periode
// pembanding, jadi semua nilai previous bernilai null; `period` berisi rentang
// dari customer pertama mendaftar sampai hari ini (WIB) untuk label frontend.
async function getAllTimeCustomersPerOutlet() {
  const [locations, counts, firstCustomer] = await prisma.$transaction([
    findLocations(),
    countCustomersByOutlet(),
    prisma.customer.aggregate({
      where: { owner_location_id: { not: null } },
      _min: { created_at: true },
    }),
  ]);

  const outlets = buildOutlets(locations, toCountMap(counts), null);
  const today = new Date();

  return {
    period: {
      start: formatWibDate(firstCustomer._min.created_at ?? today),
      end: formatWibDate(today),
    },
    previous_period: null,
    total_customers: sumBy(outlets, "customers"),
    previous_total_customers: null,
    outlets,
  };
}

// Customer baru (mendaftar) per outlet pada periode berjalan dan periode
// pembanding, dikelompokkan menurut owner_location_id.
async function getCustomersPerOutlet(period) {
  try {
    if (period === ALL_TIME_PERIOD) return await getAllTimeCustomersPerOutlet();

    const { current, previous } = getDashboardPeriodRange(period);

    const [locations, currentCounts, previousCounts] =
      await prisma.$transaction([
        findLocations(),
        countCustomersByOutlet({ gte: current.start_at, lte: current.end_at }),
        countCustomersByOutlet({
          gte: previous.start_at,
          lte: previous.end_at,
        }),
      ]);

    const outlets = buildOutlets(
      locations,
      toCountMap(currentCounts),
      toCountMap(previousCounts),
    );

    return {
      period: { start: current.start, end: current.end },
      previous_period: { start: previous.start, end: previous.end },
      total_customers: sumBy(outlets, "customers"),
      previous_total_customers: sumBy(outlets, "previous_customers"),
      outlets,
    };
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

// Produk loyalty yang paling sering di-redeem pada periode berjalan.
//
// SEMENTARA (heuristik): SaleTransaction belum menyimpan item mana yang
// ditukar poin; `products` hanya berisi array product_id Runchise dan
// `redeemed_point` hanya total poin per transaksi. Satu transaksi dihitung
// sebagai redeem sebuah loyalty product bila:
//   - redeemed_point > 0 dan >= point_needed produk tersebut, dan
//   - products memuat runchise_product_id produk tersebut.
// Keterbatasan: produk yang dibeli normal di transaksi yang juga me-redeem
// poin bisa ikut terhitung, dan quantity tidak diketahui (redeem_count =
// jumlah transaksi). Ganti dengan data item per transaksi bila sudah tersedia.
async function getTopRedeemedProducts(period, limit) {
  try {
    const { current } = getDashboardPeriodRange(period);
    const curStart = toSqlTimestamp(current.start_at);
    const curEnd = toSqlTimestamp(current.end_at);

    const rows = await prisma.$queryRaw`
      WITH redeem_transactions AS (
        SELECT transaction_id, products, redeemed_point_value
        FROM (
          SELECT
            transaction_id,
            products,
            CASE
              WHEN redeemed_point ~ '^[0-9]+(\\.[0-9]+)?$'
                THEN redeemed_point::numeric
              ELSE 0
            END AS redeemed_point_value
          FROM "SaleTransaction"
          WHERE sales_time BETWEEN ${curStart}::timestamp AND ${curEnd}::timestamp
            AND jsonb_typeof(products) = 'array'
        ) t
        WHERE redeemed_point_value > 0
      ),
      product_redeems AS (
        SELECT
          lp.loyalty_product_id,
          lp.product_name,
          lp.point_needed,
          COUNT(DISTINCT rt.transaction_id)::int AS redeem_count
        FROM "LoyaltyProduct" lp
        JOIN redeem_transactions rt
          ON rt.redeemed_point_value >= lp.point_needed
         AND EXISTS (
           SELECT 1
           FROM jsonb_array_elements_text(rt.products) AS p(product_id)
           WHERE p.product_id = lp.runchise_product_id::text
         )
        GROUP BY lp.loyalty_product_id, lp.product_name, lp.point_needed
      )
      SELECT
        loyalty_product_id,
        product_name,
        point_needed,
        redeem_count,
        -- Window dievaluasi sebelum LIMIT: total seluruh produk, bukan top N
        SUM(redeem_count) OVER ()::int AS total_redeem
      FROM product_redeems
      ORDER BY redeem_count DESC, product_name ASC
      LIMIT ${limit}
    `;

    return {
      period: { start: current.start, end: current.end },
      total_redeem: rows[0]?.total_redeem ?? 0,
      products: rows.map((row) => ({
        loyalty_product_id: row.loyalty_product_id,
        product_name: row.product_name,
        point_needed: row.point_needed,
        redeem_count: row.redeem_count,
      })),
    };
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

// Transaksi terbaru seluruh customer untuk tabel "Recent Transactions",
// dicari berdasarkan nama customer atau nomor sales. Nama field mengikuti
// kolom tabel di frontend (sales_no, customer.name, order_type), bukan nama
// kolom database.
async function getRecentTransactions({ search, skip, take } = {}) {
  try {
    const where = {};

    if (search) {
      where.OR = [
        { customer: { name: { contains: search, mode: "insensitive" } } },
        { runchise_sales_no: { contains: search, mode: "insensitive" } },
      ];
    }

    const [total, transactions] = await prisma.$transaction([
      prisma.saleTransaction.count({ where }),
      prisma.saleTransaction.findMany({
        where,
        take,
        skip,
        orderBy: { sales_time: { sort: "desc", nulls: "last" } },
        select: {
          transaction_id: true,
          runchise_sales_no: true,
          gross_sales: true,
          net_sales_after_tax: true,
          location_name: true,
          order_type_name: true,
          sales_time: true,
          customer: { select: { customer_id: true, name: true } },
        },
      }),
    ]);

    return {
      total,
      total_page: take ? Math.ceil(total / take) : 1,
      transactions: transactions.map((transaction) => ({
        transaction_id: transaction.transaction_id,
        sales_no: transaction.runchise_sales_no,
        customer: transaction.customer,
        gross_sales: transaction.gross_sales,
        location_name: transaction.location_name,
        order_type: transaction.order_type_name,
        net_sales_after_tax: transaction.net_sales_after_tax,
        sales_time: transaction.sales_time,
      })),
    };
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

module.exports = {
  getTotalCounts,
  getCustomersPerOutlet,
  getTopRedeemedProducts,
  getRecentTransactions,
};
