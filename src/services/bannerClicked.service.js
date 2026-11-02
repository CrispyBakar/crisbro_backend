const prisma = require("../lib/prisma");
const { Prisma } = require("@prisma/client");

async function listBannerClickedService({
  take,
  skip,
  banner_id,
  user_id,
} = {}) {
  const filter = {};

  if (banner_id) filter.banner_id = banner_id;
  if (user_id) filter.user_id = user_id;

  const [total, bannerClicked] = await prisma.$transaction([
    prisma.bannerClicked.count({ where: filter }),
    prisma.bannerClicked.findMany({
      where: filter,
      take,
      skip,
      orderBy: [{ created_at: "desc" }],
    }),
  ]);

  return {
    total,
    total_page: take ? Math.ceil(total / take) : 1,
    bannerClicked,
  };
}

async function getBannerClickedAnalyticsService({
  start_date,
  end_date,
  banner_id,
  user_id,
}) {
  const filters = [];
  if (banner_id) filters.push(Prisma.sql`clicked.banner_id = ${banner_id}`);
  if (user_id) filters.push(Prisma.sql`clicked.user_id = ${user_id}`);

  const filterSql = filters.length
    ? Prisma.sql`AND ${Prisma.join(filters, " AND ")}`
    : Prisma.empty;

  const series = await prisma.$queryRaw(Prisma.sql`
    WITH date_series AS (
      SELECT generate_series(
        ${start_date}::date,
        ${end_date}::date,
        INTERVAL '1 day'
      )::date AS day
    )
    SELECT
      to_char(date_series.day, 'YYYY-MM-DD') AS date,
      COUNT(clicked.banner_clicked_id)::int AS clicks
    FROM date_series
    LEFT JOIN "BannerClicked" AS clicked
      ON clicked.created_at >= date_series.day::timestamp - INTERVAL '7 hours'
      AND clicked.created_at < (date_series.day + 1)::timestamp - INTERVAL '7 hours'
      ${filterSql}
    GROUP BY date_series.day
    ORDER BY date_series.day
  `);

  return {
    total_clicks: series.reduce(
      (total, point) => total + Number(point.clicks),
      0,
    ),
    series: series.map((point) => ({
      date: point.date,
      clicks: Number(point.clicks),
    })),
  };
}

module.exports = {
  listBannerClickedService,
  getBannerClickedAnalyticsService,
};
