jest.mock("../src/lib/prisma", () => ({
  $queryRaw: jest.fn(),
}));

const prisma = require("../src/lib/prisma");
const {
  getBannerClickedAnalyticsService,
} = require("../src/services/bannerClicked.service");
const {
  bannerClickedAnalyticsQuerySchema,
} = require("../src/controllers/bannerClicked.controller");

describe("banner-clicked analytics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("validates the required dates, optional UUID filters, and date order", () => {
    expect(
      bannerClickedAnalyticsQuerySchema.safeParse({
        start_date: "2026-10-01",
        end_date: "2026-10-31",
      }).success,
    ).toBe(true);

    expect(
      bannerClickedAnalyticsQuerySchema.safeParse({
        start_date: "2026-02-31",
        end_date: "2026-03-01",
      }).success,
    ).toBe(false);

    expect(
      bannerClickedAnalyticsQuerySchema.safeParse({
        start_date: "2026-10-02",
        end_date: "2026-10-01",
      }).success,
    ).toBe(false);
  });

  test("returns daily counts including zero days and totals them", async () => {
    prisma.$queryRaw.mockResolvedValue([
      { date: "2026-10-01", clicks: 8 },
      { date: "2026-10-02", clicks: 0 },
      { date: "2026-10-03", clicks: "4" },
    ]);

    await expect(
      getBannerClickedAnalyticsService({
        start_date: "2026-10-01",
        end_date: "2026-10-03",
      }),
    ).resolves.toEqual({
      total_clicks: 12,
      series: [
        { date: "2026-10-01", clicks: 8 },
        { date: "2026-10-02", clicks: 0 },
        { date: "2026-10-03", clicks: 4 },
      ],
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  test("binds the user filter as SQL instead of interpolating an object", async () => {
    const userId = "9c2aaf14-55b0-4b54-a188-5bd8fc431f69";
    prisma.$queryRaw.mockResolvedValue([]);

    await getBannerClickedAnalyticsService({
      start_date: "2026-10-01",
      end_date: "2026-10-31",
      user_id: userId,
    });

    const query = prisma.$queryRaw.mock.calls[0][0];
    expect(query.sql).toContain("clicked.user_id =");
    expect(query.values).toContain(userId);
  });
});
