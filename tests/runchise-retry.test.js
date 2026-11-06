// Test retry pada deactivatePromoCode (src/services/runchise.service.js).

jest.mock("../src/lib/prisma", () => ({}));

// Mock axios: isAxiosError + client palsu yang kita kontrol per-test.
const mockPatch = jest.fn();
jest.mock("axios", () => ({
  isAxiosError: (e) => e?.isAxiosError === true,
  create: () => ({ patch: (...args) => mockPatch(...args) }),
}));
jest.mock("dotenv", () => ({ config: () => {} }));

const { deactivatePromoCode } = require("../src/services/runchise.service");

function axiosError(response) {
  const err = new Error(response ? `HTTP ${response.status}` : "network error");
  err.isAxiosError = true;
  err.code = response ? undefined : "ECONNRESET";
  err.response = response;
  return err;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("sukses pada percobaan kedua setelah 503 (retry bekerja)", async () => {
  mockPatch
    .mockRejectedValueOnce(axiosError({ status: 503 }))
    .mockResolvedValueOnce({ status: 204 });

  await expect(
    deactivatePromoCode("promo-1", "code-1"),
  ).resolves.toBe(true);
  expect(mockPatch).toHaveBeenCalledTimes(2);
});

test("setelah retries habis, throw error dengan code RUNCHISE_REQUEST_FAILED", async () => {
  mockPatch.mockRejectedValue(axiosError({ status: 502 }));

  await expect(deactivatePromoCode("promo-1", "code-1")).rejects.toMatchObject({
    code: "RUNCHISE_REQUEST_FAILED",
    statusCode: 502,
  });
  // 1 percobaan awal + 3 retry = 4 panggilan.
  expect(mockPatch).toHaveBeenCalledTimes(4);
}, 15000); // backoff riil 1s + 2s + 4s = 7 detik

test("error 404 tidak di-retry (langsung gagal)", async () => {
  mockPatch.mockRejectedValue(axiosError({ status: 404 }));

  await expect(deactivatePromoCode("promo-1", "code-1")).rejects.toThrow();
  expect(mockPatch).toHaveBeenCalledTimes(1);
});
