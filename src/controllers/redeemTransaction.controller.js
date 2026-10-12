const {
  redeemLoyaltyVoucher,
  listMyRedeemedVouchers,
  getMyRedeemedVoucher,
  listRedeemedVouchers,
  getRedeemedVoucher,
  RedeemError,
} = require("../services/redeemTransaction.service");
const {
  redeemLoyaltyVoucherSchema,
  redeemTransactionParamsSchema,
  listMyRedeemedVoucherQuerySchema,
  listRedeemedVoucherQuerySchema,
} = require("../validation/redeemTransaction/redeemTransaction-validation");
const {
  successRequest,
  badRequest,
  respondWithServerError,
} = require("../utils/responseReuest");

function validationError(res, error) {
  return badRequest({
    res,
    code: 422,
    error: error.flatten().fieldErrors,
  });
}

// Hanya RedeemError yang pesannya aman ditampilkan; error lain (Prisma,
// Runchise) jangan diteruskan mentah ke client.
function respondRedeemError(res, error, context) {
  if (error instanceof RedeemError) {
    return badRequest({
      res,
      code: error.statusCode,
      error: error.message,
    });
  }

  return respondWithServerError(res, error, context);
}

async function redeemLoyaltyVoucherController(req, res) {
  // user_id selalu dari sesi login, bukan dari body, supaya customer tidak
  // bisa menukar poin milik customer lain.
  const { user_id } = req.user ?? {};
  const validation = redeemLoyaltyVoucherSchema.safeParse(req.body ?? {});

  if (!validation.success) {
    return validationError(res, validation.error);
  }

  try {
    const result = await redeemLoyaltyVoucher(
      user_id,
      validation.data.loyalty_product_id,
    );

    return successRequest({
      res,
      code: 201,
      message: "Voucher redeemed successfully",
      data: result,
    });
  } catch (error) {
    return respondRedeemError(res, error, "Redeem loyalty voucher failed");
  }
}

async function listMyRedeemedVouchersController(req, res) {
  const { user_id } = req.user ?? {};
  const validation = listMyRedeemedVoucherQuerySchema.safeParse(req.query);

  if (!validation.success) {
    return validationError(res, validation.error);
  }

  try {
    const result = await listMyRedeemedVouchers(user_id, validation.data);

    return successRequest({
      res,
      code: 200,
      message: "Redeemed vouchers retrieved successfully",
      data: result,
    });
  } catch (error) {
    return respondRedeemError(res, error, "List my redeemed vouchers failed");
  }
}

async function getMyRedeemedVoucherController(req, res) {
  const { user_id } = req.user ?? {};
  const validation = redeemTransactionParamsSchema.safeParse(req.params);

  if (!validation.success) {
    return validationError(res, validation.error);
  }

  try {
    const result = await getMyRedeemedVoucher(
      user_id,
      validation.data.redeem_transaction_id,
    );

    return successRequest({
      res,
      code: 200,
      message: "Redeemed voucher retrieved successfully",
      data: result,
    });
  } catch (error) {
    return respondRedeemError(res, error, "Get my redeemed voucher failed");
  }
}

async function listRedeemedVouchersController(req, res) {
  const validation = listRedeemedVoucherQuerySchema.safeParse(req.query);

  if (!validation.success) {
    return validationError(res, validation.error);
  }

  try {
    const result = await listRedeemedVouchers(validation.data);

    return successRequest({
      res,
      code: 200,
      message: "Redeemed vouchers retrieved successfully",
      data: result,
    });
  } catch (error) {
    return respondRedeemError(res, error, "List redeemed vouchers failed");
  }
}

async function getRedeemedVoucherController(req, res) {
  const validation = redeemTransactionParamsSchema.safeParse(req.params);

  if (!validation.success) {
    return validationError(res, validation.error);
  }

  try {
    const result = await getRedeemedVoucher(
      validation.data.redeem_transaction_id,
    );

    return successRequest({
      res,
      code: 200,
      message: "Redeemed voucher retrieved successfully",
      data: result,
    });
  } catch (error) {
    return respondRedeemError(res, error, "Get redeemed voucher failed");
  }
}

module.exports = {
  redeemLoyaltyVoucherController,
  listMyRedeemedVouchersController,
  getMyRedeemedVoucherController,
  listRedeemedVouchersController,
  getRedeemedVoucherController,
};
