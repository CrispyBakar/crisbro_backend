const { z } = require("zod");
const {
  ALL_TIME_PERIOD,
  DASHBOARD_PERIODS,
} = require("../../lib/dashboardPeriod");

const dashboardPeriodQuerySchema = z.object({
  period: z.enum(DASHBOARD_PERIODS).default("month"),
});

// Customer per outlet juga bisa dilihat keseluruhan (tanpa filter tanggal)
const customersPerOutletQuerySchema = z.object({
  period: z.enum([...DASHBOARD_PERIODS, ALL_TIME_PERIOD]).default("month"),
});

const topRedeemedProductsQuerySchema = dashboardPeriodQuerySchema.extend({
  limit: z.coerce.number().int().positive().max(50).default(7),
});

const recentTransactionsQuerySchema = z.object({
  search: z.string().trim().default(""),
  take: z.coerce.number().int().positive().max(100).default(25),
  skip: z.coerce.number().int().min(0).default(0),
});

module.exports = {
  dashboardPeriodQuerySchema,
  customersPerOutletQuerySchema,
  topRedeemedProductsQuerySchema,
  recentTransactionsQuerySchema,
};
