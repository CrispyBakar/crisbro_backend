const prisma = require("../lib/prisma");
const {
  generateLoyaltyProducts,
  getAllProducts,
} = require("./runchise.service");

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
      }),
    ]);

    return {
      total,
      total_page: take ? Math.ceil(total / take) : 1,
      loyalty_products,
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

async function listAllProducts({ search, take, skip }) {
  try {
    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { sku: { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined;

    const [products, total] = await prisma.$transaction([
      prisma.products.findMany({ where, take, skip, orderBy: { name: "asc" } }),
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
