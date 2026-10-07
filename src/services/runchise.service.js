const prisma = require("../lib/prisma");
const dotenv = require("dotenv");
const axios = require("axios");
const {
  createCustomerSchema,
  createPromoSchema,
  updatePromoSchema,
} = require("../validation/runchise/runchise-validation");
const {
  updateCustomerSchema,
  deactivateCustomerSchema,
} = require("../validation/customer/customer-validation");
const { generateRandomUniqueCode } = require("../utils/generateReferralCode");

dotenv.config();

const runchiseClient = axios.create({
  baseURL: "https://runchise-api.crispybakar.biz/api/public",
  timeout: 60000, // 60 detik
  headers: {
    Accept: "application/json",
    Authorization: process.env.RUNCHISE_API_KEY,
    "Content-Type": "application/json",
  },
});

function normalizeIndonesianPhone(raw) {
  if (!raw) return null;

  const digits = String(raw).replace(/\D/g, "");
  if (digits.startsWith("62")) return digits.slice(2);
  if (digits.startsWith("0")) return digits.slice(1);
  return digits;
}

async function findCustomerByPhone({ phone }) {
  const phone_number = normalizeIndonesianPhone(phone);
  const locationIds = await findAllLocationIds();

  for (const locationId of locationIds) {
    try {
      const result = await runchiseClient.get(
        `/locations/${locationId}/customers?phone_number=${phone_number}`,
      );
      const customer = result.data?.customers?.[0];
      if (customer) return customer;
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  return null;
}

async function generateAllCustomerHasPoint() {
  try {
    const locationIds = await findAllLocationIds();
    const customers = [];

    for (let i = 0; i < locationIds.length; i++) {
      let next_page = undefined;
      let currentCustomers = [];
      const res = await runchiseClient.get(
        `/locations/${locationIds[i]}/customers?item_per_page=1000`,
      );

      const data = res.data?.customers;
      currentCustomers.push(...data);
      next_page = res.data?.paging?.next_page ?? null;

      while (next_page) {
        const [_, url] = next_page.split("/public/");
        const nextRes = await runchiseClient.get(`${url}&item_per_page=1000`);
        const data = nextRes.data?.customers;

        currentCustomers.push(...data);
        next_page = nextRes.data?.paging?.next_page ?? null;

        // Jeda 5 detik setelah berhasil fetch setiap halaman berikutnya
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      customers.push(...currentCustomers);
    }

    const customerFilter = customers.filter((v) => Number(v.total_point) > 0);

    return customerFilter;
  } catch (error) {
    console.log(error);
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.message
        ? JSON.stringify(error.response.data.message)
        : error.message;
      throw new Error(message);
    }
    throw error;
  }
}

async function createCustomer(payload) {
  try {
    const validate = createCustomerSchema.safeParse(payload);

    if (!validate.success) {
      throw new Error(JSON.stringify(validate.error.flatten().fieldErrors));
    }

    const data = validate.data;
    const result = await runchiseClient.post(
      `/locations/${data.owner_location_id}/customers`,
      data,
    );

    return result.data?.customer ?? null;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = JSON.stringify(error.response.data.message);
      throw new Error(message);
    }
    throw error;
  }
}

async function updateCustomer(
  runchise_customer_id,
  runchise_location_id,
  payload,
) {
  try {
    const validate = updateCustomerSchema.safeParse(payload);

    if (!validate.success) {
      throw new Error(JSON.stringify(validate.error.flatten().fieldErrors));
    }

    const data = { ...validate.data };
    // Validasi mengubah dob jadi Date; ke Runchise dikirim sebagai tanggal saja
    // ("YYYY-MM-DD"), bukan tanggal-jam. null (hapus tanggal lahir) diteruskan
    // apa adanya.
    if (data.dob) {
      data.dob = new Date(data.dob).toISOString().slice(0, 10);
    }

    const result = await runchiseClient.patch(
      `/locations/${runchise_location_id}/customers/${runchise_customer_id}`,
      data,
    );

    return result.data?.customer ?? null;
  } catch (error) {
    // error.response kosong bila gagalnya bukan dari respons Runchise
    // (validasi di atas, timeout, jaringan)
    console.log(error.response?.data ?? error.message);
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.message
        ? JSON.stringify(error.response.data.message)
        : error.message;
      throw new Error(message);
    }
    throw error;
  }
}

async function activateCustomer(
  runchise_customer_id,
  runchise_location_id,
  status,
) {
  try {
    const validate = deactivateCustomerSchema.safeParse(status);

    if (!validate.success) {
      throw new Error(JSON.stringify(validate.error.flatten().fieldErrors));
    }

    const data = validate.data;

    if (data.status !== "active") {
      throw new Error("Status harus active");
    }

    const result = await runchiseClient.patch(
      `/locations/${runchise_location_id}/customers/${runchise_customer_id}/unarchive`,
    );

    return true;
  } catch (error) {
    console.log(error.response.data);
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.message
        ? JSON.stringify(error.response.data.message)
        : error.message;
      throw new Error(message);
    }
    throw error;
  }
}

async function deactivateCustomer(
  runchise_customer_id,
  runchise_location_id,
  status,
) {
  try {
    const validate = deactivateCustomerSchema.safeParse(status);

    if (!validate.success) {
      throw new Error(JSON.stringify(validate.error.flatten().fieldErrors));
    }

    const data = validate.data;

    if (data.status !== "inactive") {
      throw new Error("Status harus inactive");
    }

    const result = await runchiseClient.patch(
      `/locations/${runchise_location_id}/customers/${runchise_customer_id}/archive`,
    );

    return true;
  } catch (error) {
    console.log(error.response.data);
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.message
        ? JSON.stringify(error.response.data.message)
        : error.message;
      throw new Error(message);
    }
    throw error;
  }
}

async function findAllLocationIds() {
  try {
    const result = await runchiseClient.get(`/locations`);
    const locations = result.data?.locations;

    if (!Array.isArray(locations)) {
      throw new Error("Tidak dapat menemukan location id");
    }

    return locations
      .map((location) => Number(location.id))
      .filter((id) => Number.isInteger(id) && id > 0);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function listAllLocations() {
  try {
    const locations = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await runchiseClient.get("/locations", {
        params: { page, item_per_page: 100 },
      });
      const pageLocations = response.data?.locations;

      if (!Array.isArray(pageLocations)) {
        throw new Error("Tidak dapat menemukan semua locations");
      }

      locations.push(...pageLocations);
      const paging = response.data?.paging;
      hasMore = paging?.next_page
        ? true
        : Number.isFinite(Number(paging?.total_item))
          ? locations.length < Number(paging.total_item)
          : pageLocations.length === 100;
      page += 1;

      if (page > 100) {
        throw new Error("Jumlah halaman locations Runchise melebihi batas");
      }
    }

    return locations;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function listAllSubBrands() {
  try {
    const response = await runchiseClient.get("/sub_brands");
    const sub_brands = response.data.sub_brands;

    if (!Array.isArray(sub_brands)) {
      throw new Error("Tidak dapat menemukan semua sub brands");
    }

    return sub_brands;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function listSaleTransactionByCustomerId(runchise_customer_id) {
  try {
    if (!runchise_customer_id)
      throw new Error("Runchise Customer Id is required");

    let response = await runchiseClient.get(
      `/sale_transactions?customer_id=${runchise_customer_id}&item_per_page=1000`,
    );

    let paging = response.data.paging;
    let sale_transactions = response.data.sale_transactions;

    while (paging.next_page) {
      response = await runchiseClient.get(paging.next_page);
      paging = response.data.paging;
      sale_transactions = [
        ...sale_transactions,
        ...response.data.sale_transactions,
      ];
    }

    return sale_transactions;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function syncProductsFromRunchise(runchise_product_ids) {
  try {
    if (
      !Array.isArray(runchise_product_ids) ||
      runchise_product_ids.length === 0
    ) {
      throw new Error("Runchise Product Ids is required");
    }

    let products = [];
    for (const products_id of runchise_product_ids) {
      const response = await runchiseClient.get(`/products/${products_id}`);
      const product = response.data.product;

      if (!product) {
        throw new Error(`Product with id ${products_id} not found`);
      }

      // Sync product to local database
      const syncedProduct = await prisma.product.upsert({
        where: { runchise_product_id: products_id },
        update: {
          name: product.name,
          price: product.price,
          stock: product.stock,
        },
        create: {
          runchise_product_id: products_id,
          name: product.name,
          price: product.price,
          stock: product.stock,
        },
      });

      products.push(syncedProduct);
    }

    return products;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function generateLoyaltyProducts() {
  try {
    const response = await runchiseClient.get(`/loyalties`);
    const loyalties = response.data.loyalties;

    if (!Array.isArray(loyalties)) {
      throw new Error("Tidak dapat menemukan semua loyalties");
    }

    // Selected loyalties is active
    const activeLoyalties = loyalties.filter((loyalty) => loyalty.is_active);

    const productsData = [];
    for (const loyalty_product of activeLoyalties.at(0)?.loyalty_products ??
      []) {
      const product_locations = await Promise.all(
        loyalty_product.product_locations.map(async (location) => {
          const productLocation = await prisma.location.findUnique({
            where: { runchise_id: location.id },
          });
          return productLocation?.location_id;
        }),
      );

      const location_ids = await Promise.all(
        loyalty_product.locations.map(async (location) => {
          const ownLocation = await prisma.location.findUnique({
            where: { runchise_id: location.id },
          });
          return ownLocation?.location_id;
        }),
      );

      const product_location_ids = product_locations.filter(Boolean);
      const location_ids_filtered = location_ids.filter(Boolean);

      productsData.push({
        runchise_loyalty_product_id: loyalty_product.id,
        runchise_product_id: loyalty_product.product_id,
        point_needed: loyalty_product.point_needed,
        product_name: loyalty_product.product_name,
        product_sku: loyalty_product.product_sku,
        product_description: loyalty_product.product_description,
        product_image_url: loyalty_product.product_image_url,
        product_unit_name: loyalty_product.product_unit_name,
        max_redeem: loyalty_product.max_redeem,
        is_select_all_location: loyalty_product.is_select_all_location,
        location_ids: location_ids_filtered,
        product_location_ids: product_location_ids,
      });
    }

    // Runchise can change loyalty product ids when updating the loyalty
    // program, so rebuild from scratch instead of upserting
    const products = await prisma.$transaction(async (tx) => {
      await tx.loyaltyProduct.deleteMany({});
      await tx.loyaltyProduct.createMany({ data: productsData });

      return tx.loyaltyProduct.findMany({
        orderBy: { runchise_loyalty_product_id: "asc" },
      });
    });

    return products;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function createPromo(payload) {
  try {
    const validate = createPromoSchema.safeParse(payload);

    if (!validate.success) {
      throw validate.error;
    }

    const data = validate.data;
    const result = await runchiseClient.post(`/promos`, data);

    return result.data?.promo ?? null;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.errors
        ? JSON.stringify(error.response.data.errors)
        : error.message;
      throw Object.assign(new Error(message, { cause: error }), {
        code: "RUNCHISE_REQUEST_FAILED",
        statusCode: 502,
      });
    }
    throw error;
  }
}

async function updatePromo(runchise_promo_id, payload) {
  try {
    const validate = updatePromoSchema.safeParse(payload);

    if (!validate.success) {
      throw validate.error;
    }

    const result = await runchiseClient.patch(
      `/promos/${runchise_promo_id}`,
      validate.data,
    );

    return result.data?.promo ?? null;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.errors
        ? JSON.stringify(error.response.data.errors)
        : error.message;
      throw Object.assign(new Error(message, { cause: error }), {
        code: "RUNCHISE_REQUEST_FAILED",
        statusCode: 502,
      });
    }
    throw error;
  }
}

async function deactivatePromo(runchise_promo_id) {
  try {
    const result = await runchiseClient.patch(
      `/promos/${runchise_promo_id}/deactivate`,
    );

    return result.status === 204 ? true : null;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.errors
        ? JSON.stringify(error.response.data.errors)
        : error.message;
      throw Object.assign(new Error(message, { cause: error }), {
        code: "RUNCHISE_REQUEST_FAILED",
        statusCode: 502,
      });
    }
    throw error;
  }
}

async function activatePromo(runchise_promo_id) {
  try {
    const result = await runchiseClient.patch(
      `/promos/${runchise_promo_id}/activate`,
    );
    return result.status === 204 ? true : null;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.errors
        ? JSON.stringify(error.response.data.errors)
        : error.message;
      throw Object.assign(new Error(message, { cause: error }), {
        code: "RUNCHISE_REQUEST_FAILED",
        statusCode: 502,
      });
    }
    throw error;
  }
}

async function generatePromoCode({ runchise_promo_id, total_code }) {
  try {
    const { z, custom } = require("zod");
    const input = z
      .object({
        runchise_promo_id: z.number().int().positive(),
        total_code: z.number().int().min(1).max(1000),
      })
      .parse({ runchise_promo_id, total_code });
    total_code = input.total_code;
    const defaultLength = 7;
    const defaultMaxUsage = 1;

    const codes = [];
    const usedCodes = new Set();
    let attempts = 0;

    while (codes.length < total_code) {
      if (++attempts > total_code * 20) {
        throw new Error(
          "Gagal menghasilkan promo code unik dalam batas percobaan",
        );
      }
      const code = generateRandomUniqueCode(defaultLength);
      if (usedCodes.has(code)) continue;
      usedCodes.add(code);
      codes.push({
        code: code,
        maximum_usage: defaultMaxUsage,
      });
    }

    const payload = {
      source: "array",
      promo_codes: codes,
    };

    const response = await runchiseClient.post(
      `/promos/${runchise_promo_id}/promo_codes`,
      payload,
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.errors
        ? JSON.stringify(error.response.data.errors)
        : error.message;
      throw Object.assign(new Error(message, { cause: error }), {
        code: "RUNCHISE_REQUEST_FAILED",
        statusCode: 502,
      });
    }
    throw error;
  }
}

async function getPromo(runchise_promo_id) {
  try {
    const response = await runchiseClient.get(`/promos/${runchise_promo_id}`);
    return response.data?.promo ?? null;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.errors
        ? JSON.stringify(error.response.data.errors)
        : error.message;
      throw Object.assign(new Error(message, { cause: error }), {
        code: "RUNCHISE_REQUEST_FAILED",
        statusCode: 502,
      });
    }
    throw error;
  }
}

async function getListPromoCodes(runchise_promo_id) {
  try {
    const response = await runchiseClient.get(
      `/promos/${runchise_promo_id}/promo_codes`,
    );

    const data = response.data.promo_codes;

    return data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.errors
        ? JSON.stringify(error.response.data.errors)
        : error.message;
      throw Object.assign(new Error(message, { cause: error }), {
        code: "RUNCHISE_REQUEST_FAILED",
        statusCode: 502,
      });
    }
    throw error;
  }
}

const RETRYABLE_STATUS = [500, 503];
const MAX_RETRIES = 3;

// GET ke runchise, retry dengan url/params yang sama kalau server balas 500/503
async function getWithRetry(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await runchiseClient.get(url);
    } catch (error) {
      const status = error.response?.status;
      if (!RETRYABLE_STATUS.includes(status) || attempt >= MAX_RETRIES) {
        throw error;
      }

      const delay = 3000 * 2 ** attempt; // 3s, 6s, 12s
      console.log(
        `Runchise ${status} pada ${url}, retry ${attempt + 1}/${MAX_RETRIES} dalam ${delay / 1000} detik`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function getListSaleTransactionSummary(lastIdsByLocation = {}) {
  const location_ids = await findAllLocationIds();
  const date = new Date();
  const now = date.toISOString().split("T")[0];

  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  const start_date = yesterday.toISOString().split("T")[0];

  const sale_transactions = [];
  const updatedLastIds = { ...lastIdsByLocation };

  for (const location_id of location_ids) {
    const checkpoint = lastIdsByLocation[location_id] ?? null;
    let cursor = null; // last_id untuk paginate mundur (older)
    let newestIdThisRun = null; // id terbaru yang ditemukan, jadi checkpoint baru
    let hasMore = true;

    try {
      while (hasMore) {
        const params = new URLSearchParams({
          location_id: String(location_id),
          start_date: String(start_date),
          end_date: String(now),
          ...(cursor ? { last_id: cursor } : {}),
        });

        const response = await getWithRetry(
          `/sale_transactions/summaries?${params}`,
        );
        const data = response.data.data ?? [];

        if (data.length === 0) {
          hasMore = false;
          break;
        }

        if (newestIdThisRun === null) {
          newestIdThisRun = data[0].id; // record pertama = paling baru
        }

        for (const trx of data) {
          if (checkpoint !== null && trx.id <= checkpoint) {
            hasMore = false; // sudah ketemu data lama, stop
            break;
          }
          sale_transactions.push(trx);
        }

        if (hasMore) {
          const lastRecord = data[data.length - 1];
          cursor = lastRecord.id; // lanjut mundur dari record paling lama di halaman ini
          // opsional: kalau data.length < page_size dari API, berarti sudah halaman terakhir
        }

        // Delay 1 detik sebelum lanjut
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (newestIdThisRun !== null) {
        updatedLastIds[location_id] = newestIdThisRun;
      }
    } catch (error) {
      console.log(
        `Gagal fetch sale transactions summary location ${location_id}:`,
        error.message,
      );
      continue;
    }
  }

  return { sale_transactions, lastIdsByLocation: updatedLastIds };
}

async function getDetailSaleTransaction(runchise_sale_transaction_id) {
  try {
    const response = await runchiseClient.get(
      `/sale_transactions/${runchise_sale_transaction_id}`,
    );
    const data = response.data;

    return data.sale_transaction;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.errors
        ? JSON.stringify(error.response.data.errors)
        : error.message;
      throw Object.assign(new Error(message, { cause: error }), {
        code: "RUNCHISE_REQUEST_FAILED",
        statusCode: 502,
      });
    }
    throw error;
  }
}

async function getListCustomerPointHistory(runchise_customer_id) {
  try {
    let has_more = true;
    let last_id = undefined;
    let histories = [];

    while (has_more) {
      const params = new URLSearchParams({
        ...(last_id ? { last_id: String(last_id) } : {}),
      });

      const res = await runchiseClient.get(
        `/customer_point/${runchise_customer_id}/history?${params}`,
      );

      const data = res.data;

      histories.push(...data.customer_point_histories);
      has_more = data.paging.has_more;
      last_id = data.paging.last_id;
    }

    return histories;
  } catch (error) {
    // 404 berarti customer belum punya riwayat poin di runchise
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return [];
    }
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.errors
        ? JSON.stringify(error.response.data.errors)
        : error.message;
      throw Object.assign(new Error(message, { cause: error }), {
        code: "RUNCHISE_REQUEST_FAILED",
        statusCode: 502,
      });
    }
    throw error;
  }
}

async function getAllProducts() {
  try {
    let next_page = undefined;
    const products = [];

    do {
      let res;

      if (!next_page) {
        res = await runchiseClient.get(`/products`);
      } else {
        const afterPublic = next_page.split("/public")[1];
        res = await runchiseClient.get(afterPublic);
      }

      const result = res.data;

      // Sync products to local database
      for (const product of result.products) {
        const data = {
          runchise_id: product.id,
          name: product.name,
          sku: product.sku,
          upc: product.upc,
          description: product.description,
          internal_price: product.internal_price,
          sell_price: product.sell_price,
          status: product.status,
          product_category: product.product_category?.name ?? null,
          image_url: product.image_url ?? "",
        };

        const syncedProduct = await prisma.products.upsert({
          where: { runchise_id: product.id },
          update: data,
          create: data,
        });

        products.push(syncedProduct);
      }

      next_page = result.paging.next_page;
    } while (next_page);

    return products;
  } catch (error) {
    const message = error.response?.data?.errors
      ? JSON.stringify(error.response.data.errors)
      : error.message;
    throw Object.assign(new Error(message, { cause: error }), {
      code: "RUNCHISE_REQUEST_FAILED",
      statusCode: 502,
    });
  }
}

async function adjustCustomerPoint(
  runchise_customer_id,
  point_adjustment,
  type_adjust,
) {
  try {
    const point =
      type_adjust === "add"
        ? Number(point_adjustment)
        : -Number(point_adjustment);

    const payload = {
      point: point,
      notes: `Adjustment point ${type_adjust} by system`,
    };

    const result = await runchiseClient.post(
      `/customer_point/${runchise_customer_id}/adjust_point`,
      payload,
    );

    return true;
  } catch (error) {
    console.log(error.response?.data);
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.errors
        ? JSON.stringify(error.response.data.errors)
        : error.message;
      throw Object.assign(new Error(message, { cause: error }), {
        code: "RUNCHISE_REQUEST_FAILED",
        statusCode: 502,
      });
    }
    throw error;
  }
}

module.exports = {
  findCustomerByPhone,
  adjustCustomerPoint,
  createCustomer,
  updateCustomer,
  activateCustomer,
  deactivateCustomer,
  listAllLocations,
  listAllSubBrands,
  listSaleTransactionByCustomerId,
  syncProductsFromRunchise,
  generateLoyaltyProducts,
  createPromo,
  updatePromo,
  deactivatePromo,
  activatePromo,
  generatePromoCode,
  getListPromoCodes,
  getPromo,
  getListSaleTransactionSummary,
  getListCustomerPointHistory,
  getAllProducts,
  generateAllCustomerHasPoint,
  getDetailSaleTransaction,
};
