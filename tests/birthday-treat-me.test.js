// Unit test untuk getMyBirthdayTreat (endpoint GET /api/birthday-treat/me).

jest.mock("../src/lib/prisma", () => ({
  customer: {
    findUnique: jest.fn(),
  },
  userBirthdayTreat: {
    findFirst: jest.fn(),
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
const { getMyBirthdayTreat } = require("../src/services/birthday.service");

beforeEach(() => {
  jest.clearAllMocks();
});

test("mengembalikan treat pending milik customer yang login", async () => {
  prisma.customer.findUnique.mockResolvedValue({ customer_id: "cust-1" });
  prisma.userBirthdayTreat.findFirst.mockResolvedValue({
    user_birthday_id: "treat-1",
    birthday_date: new Date("2026-11-05"),
    treat_year: 2026,
    status: "pending",
    created_at: new Date("2026-11-05T02:00:00Z"),
    promo_code_id: "promo-1",
  });

  const result = await getMyBirthdayTreat("user-1");

  // customer dicari berdasarkan user_id dari sesi, bukan input client.
  expect(prisma.customer.findUnique).toHaveBeenCalledWith({
    where: { user_id: "user-1" },
    select: { customer_id: true },
  });
  // Hanya treat "pending" yang dianggap claimable.
  expect(prisma.userBirthdayTreat.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { customer_id: "cust-1", status: "pending" },
    }),
  );
  expect(result.has_claimable_treat).toBe(true);
  expect(result.treat.user_birthday_id).toBe("treat-1");
});

test("tidak ada treat pending -> has_claimable_treat false", async () => {
  prisma.customer.findUnique.mockResolvedValue({ customer_id: "cust-1" });
  prisma.userBirthdayTreat.findFirst.mockResolvedValue(null);

  const result = await getMyBirthdayTreat("user-1");

  expect(result).toEqual({ has_claimable_treat: false, treat: null });
});

test("user tanya data customer -> false, tanpa query treat", async () => {
  prisma.customer.findUnique.mockResolvedValue(null);

  const result = await getMyBirthdayTreat("user-1");

  expect(result.has_claimable_treat).toBe(false);
  expect(prisma.userBirthdayTreat.findFirst).not.toHaveBeenCalled();
});
