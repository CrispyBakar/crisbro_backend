const prisma = require("../lib/prisma");
const {
  redeemedVoucherSchema,
} = require("../validation/redeemTransaction/redeemTransaction-validation");

async function redeemedLoyaltyVoucherService({ user_id }) {
  try {
    const user = await prisma.user.findUnique({
      where: { user_id: user_id },
      select: {
        user_id: true,
        customer: {
          select: {
            customer_id: true,
          },
        },
      },
    });

    if (!user) throw new Error("User not found");

    const promoCode = await prisma.promoCode.findFirst({
      where: {
        promo_type: "loyalty_promo",
        status: "active",
      },
      select: {
        promo_code_id: true,
        promo: {
          select: {
            promo_id: true,
          },
        },
      },
    });

    if (!promoCode) throw new Error("Promo code not found");

    const customer_id = user.customer.customer_id;
    const promo_id = promoCode.promo.promo_id;

    const validate = redeemedVoucherSchema.safeParse({ promo_id, customer_id });

    if (!validate.success)
      throw new Error(validate.error.flatten().fieldErrors);

    const redeem = await prisma.redeemTransaction.create({
      data: {
        promo_code_id: promoCode.promo_code_id,
        customer_id,
      },
    });

    return redeem;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}
