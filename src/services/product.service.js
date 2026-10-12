const prisma = require("../lib/prisma");
const {
  generateLoyaltyProducts,
  getAllProducts,
} = require("./runchise.service");
const { CLAIMABLE_PROMO_CODE } = require("./redeemTransaction.service");

async function syncLoyaltyProducts() {
  try {
    const loyaltyProducts = await generateLoyaltyProducts();
    return loyaltyProducts;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function deleteLoyaltyProduct(loyalty_product_id) {
  try {
    const deletedProduct = await prisma.loyaltyProduct.delete({
      where: { loyalty_product_id: loyalty_product_id },
    });

    return deletedProduct;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function listLoyaltyProducts({ query, location_id, take, skip } = {}) {
  try {
    const where = {};

    if (location_id) {
      where.OR = [
        { location_ids: { has: location_id } },
        { is_select_all_location: true },
      ];
    }

    if (query) {
      where.OR = [
        { product_name: { contains: query, mode: "insensitive" } },
        { product_sku: { contains: query, mode: "insensitive" } },
      ];
    }

    const [total, loyalty_products] = await prisma.$transaction([
      prisma.loyaltyProduct.count({ where }),
      prisma.loyaltyProduct.findMany({
        where,
        take,
        skip,
        orderBy: { product_name: "asc" },
        include: {
          // Endpoint ini publik, jadi kode voucher tidak boleh ikut terkirim:
          // cukup info promo dan jumlah kode yang masih bisa diklaim.
          promo: {
            select: {
              promo_id: true,
              status: true,
              start_date: true,
              end_date: true,
              location_ids: true,
              terms_conditions: true,
              _count: {
                select: { PromoCode: { where: CLAIMABLE_PROMO_CODE } },
              },
            },
          },
        },
      }),
    ]);

    return {
      total,
      total_page: take ? Math.ceil(total / take) : 1,
      loyalty_products: loyalty_products.map(({ promo, ...product }) => {
        const { _count, ...promoInfo } = promo ?? {};

        return {
          ...product,
          // false: loyalty product belum dihubungkan ke promo mana pun
          has_promo: Boolean(promo),
          // false: belum ada promo, atau semua kodenya nonaktif / sudah diklaim
          is_voucher_available: (_count?.PromoCode ?? 0) > 0,
          promo: promo ? promoInfo : null,
        };
      }),
    };
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function generateAllProducts() {
  try {
    const products = await getAllProducts();
    return products;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function listAllProducts({
  search,
  take,
  skip,
  status,
  sort_by,
  order_by,
}) {
  try {
    const where = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
      ];
    }

    if (status) where.status = String(status);

    const order = sort_by ? { [sort_by]: order_by } : { name: "asc" };

    const [products, total] = await prisma.$transaction([
      prisma.products.findMany({ where, take, skip, orderBy: order }),
      prisma.products.count({ where }),
    ]);

    return {
      total,
      total_page: take ? Math.ceil(total / take) : 1,
      products,
    };
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

module.exports = {
  syncLoyaltyProducts,
  deleteLoyaltyProduct,
  listLoyaltyProducts,
  generateAllProducts,
  listAllProducts,
};
