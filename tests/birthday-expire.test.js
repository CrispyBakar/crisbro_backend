// Unit test untuk expireOldBirthdayTreats (src/services/birthday.service.js).
// Semua dependensi eksternal (Prisma, Redis, push, Runchise) di-mock,
// jadi test tidak menyentuh database/Redis/network sama sekali.

jest.mock("../src/lib/prisma", () => ({
  $transaction: jest.fn((ops) => Promise.all(ops)),
  userBirthdayTreat: {
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  promoCode: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
}));

jest.mock("../src/lib/redis", () => ({
  connection: {},
}));

jest.mock("../src/services/push.service", () => ({
  findUserSubscriptions: jest.fn(),
  sendToSubscriptions: jest.fn(),
}));

jest.mock("../src/services/runchise.service", () => ({
  deactivatePromoCode: jest.fn(),
}));

const prisma = require("../src/lib/prisma");
const { deactivatePromoCode } = require("../src/services/runchise.service");
const {
  expireOldBirthdayTreats,
} = require("../src/services/birthday.service");

const NOW = new Date("2026-11-05T03:00:00.000Z");

// Helper: buat mock promoCode.findUnique yang mengembalikan promo valid.
function mockPromoCodeFound() {
  prisma.promoCode.findUnique.mockResolvedValue({
    promo_code_id: "promo-1",
    promo: { promo_id: "promo-master-1" },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});

  // Default: tidak ada treat yang perlu di-expire.
  prisma.userBirthdayTreat.findMany.mockResolvedValue([]);
  prisma.userBirthdayTreat.updateMany.mockResolvedValue({ count: 0 });
  prisma.userBirthdayTreat.update.mockResolvedValue({});
  prisma.promoCode.update.mockResolvedValue({});
  deactivatePromoCode.mockResolvedValue({});
  mockPromoCodeFound();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("expireOldBirthdayTreats - SKENARIO 1 (unclaimed 24 jam)", () => {
  test("meng-expire treat pending dan rollback promo_code via transaction", async () => {
    prisma.userBirthdayTreat.findMany.mockImplementation(({ where }) =>
      where.status === "pending"
        ? [
            {
              user_birthday_id: "treat-1",
              customer_id: "cust-1",
              promo_code_id: "promo-1",
            },
          ]
        : [],
    );

    const result = await expireOldBirthdayTreats({ now: NOW });

    expect(result.unclaimed_expired).toBe(1);
    expect(prisma.userBirthdayTreat.update).toHaveBeenCalledWith({
      where: { user_birthday_id: "treat-1" },
      data: {
        status: "expired_unclaimed",
        expired_at: NOW,
      },
    });
    expect(prisma.promoCode.update).toHaveBeenCalledWith({
      where: { promo_code_id: "promo-1" },
      data: { is_claimed: false },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  test("error pada satu treat tidak menghentikan treat lain", async () => {
    prisma.userBirthdayTreat.findMany.mockImplementation(({ where }) =>
      where.status === "pending"
        ? [
            {
              user_birthday_id: "treat-fail",
              customer_id: "cust-1",
              promo_code_id: "promo-1",
            },
            {
              user_birthday_id: "treat-ok",
              customer_id: "cust-2",
              promo_code_id: "promo-2",
            },
          ]
        : [],
    );

    prisma.$transaction
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(Promise.all([]));

    const result = await expireOldBirthdayTreats({ now: NOW });

    expect(result.unclaimed_expired).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      type: "unclaimed",
      user_birthday_id: "treat-fail",
      error: "db down",
    });
    expect(result.success).toBe(false);
  });
});

describe("expireOldBirthdayTreats - SKENARIO 2 (redeem timeout 7 hari)", () => {
  test("find lalu updateMany dengan ids, lalu deactivate promo di Runchise", async () => {
    prisma.userBirthdayTreat.findMany.mockImplementation(({ where }) =>
      where.status === "claimed"
        ? [
            {
              user_birthday_id: "treat-a",
              customer_id: "cust-a",
              promo_code_id: "promo-1",
            },
            {
              user_birthday_id: "treat-b",
              customer_id: "cust-b",
              promo_code_id: "promo-2",
            },
          ]
        : [],
    );

    const result = await expireOldBirthdayTreats({ now: NOW });

    // Query filter benar: claimed, lewat 7 hari, belum pernah di-expire.
    expect(prisma.userBirthdayTreat.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: "claimed",
          claimed_at: {
            lt: new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000),
          },
          expired_at: null,
        },
      }),
    );

    // updateMany dipanggil dengan ids hasil findMany.
    expect(prisma.userBirthdayTreat.updateMany).toHaveBeenCalledWith({
      where: { user_birthday_id: { in: ["treat-a", "treat-b"] } },
      data: { status: "expired_redeem_timeout", expired_at: NOW },
    });

    // Promo code di-deactivate di DB lokal dan di Runchise.
    expect(prisma.promoCode.update).toHaveBeenCalledTimes(2);
    expect(deactivatePromoCode).toHaveBeenCalledWith(
      "promo-master-1",
      "promo-1",
    );

    expect(result.redeem_expired).toBe(2);
    expect(result.success).toBe(true);
  });

  test("tidak memanggil updateMany saat tidak ada treat yang di-expire", async () => {
    const result = await expireOldBirthdayTreats({ now: NOW });

    expect(prisma.userBirthdayTreat.updateMany).not.toHaveBeenCalled();
    expect(deactivatePromoCode).not.toHaveBeenCalled();
    expect(result.redeem_expired).toBe(0);
    expect(result.success).toBe(true);
  });

  test("skip deactivate bila promo_code_id null", async () => {
    prisma.userBirthdayTreat.findMany.mockImplementation(({ where }) =>
      where.status === "claimed"
        ? [
            {
              user_birthday_id: "treat-x",
              customer_id: "cust-x",
              promo_code_id: null,
            },
          ]
        : [],
    );

    const result = await expireOldBirthdayTreats({ now: NOW });

    expect(prisma.promoCode.update).not.toHaveBeenCalled();
    expect(deactivatePromoCode).not.toHaveBeenCalled();
    expect(result.redeem_expired).toBe(1);
  });

  test("error deactivate Runchise ditelan deactivatePromoCodeById, tidak reject", async () => {
    prisma.userBirthdayTreat.findMany.mockImplementation(({ where }) =>
      where.status === "claimed"
        ? [
            {
              user_birthday_id: "treat-a",
              customer_id: "cust-a",
              promo_code_id: "promo-1",
            },
          ]
        : [],
    );
    deactivatePromoCode.mockRejectedValue(new Error("runchise 500"));

    const result = await expireOldBirthdayTreats({ now: NOW });

    expect(result.redeem_expired).toBe(1);
    expect(result.success).toBe(true); // error ditelan oleh deactivatePromoCodeById
  });

  test("findMany redeem gagal -> tercatat di errors tanpa throw", async () => {
    prisma.userBirthdayTreat.findMany.mockImplementation(({ where }) =>
      where.status === "pending"
        ? []
        : Promise.reject(new Error("connection refused")),
    );

    const result = await expireOldBirthdayTreats({ now: NOW });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "redeem_expire",
          error: "connection refused",
        }),
      ]),
    );
    expect(result.success).toBe(false);
  });
});
