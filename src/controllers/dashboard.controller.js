const {
  getTotalCounts,
  getCustomersPerOutlet,
  getTopRedeemedProducts,
  getRecentTransactions,
} = require("../services/dashboard.service");
const { successRequest, badRequest } = require("../utils/responseReuest");
const {
  customersPerOutletQuerySchema,
  topRedeemedProductsQuerySchema,
  recentTransactionsQuerySchema,
} = require("../validation/dashboard/dashboard-validation");

function validationError(res, error) {
  return badRequest({
    res,
    code: 422,
    error: error.flatten().fieldErrors,
  });
}

async function getTotalCountsController(req, res) {
  try {
    const totalCounts = await getTotalCounts();

    return successRequest({
      res,
      code: 200,
      message: "Dashboard total counts retrieved successfully",
      data: totalCounts,
    });
  } catch (error) {
    return badRequest({
      res,
      code: 500,
      error: error.message,
    });
  }
}

async function getCustomersPerOutletController(req, res) {
  const validation = customersPerOutletQuerySchema.safeParse(req.query);

  if (!validation.success) {
    return validationError(res, validation.error);
  }

  try {
    const result = await getCustomersPerOutlet(validation.data.period);

    return successRequest({
      res,
      code: 200,
      message: "Dashboard customers per outlet retrieved successfully",
      data: result,
    });
  } catch (error) {
    return badRequest({
      res,
      code: 500,
      error: error.message,
    });
  }
}

async function getTopRedeemedProductsController(req, res) {
  const validation = topRedeemedProductsQuerySchema.safeParse(req.query);

  if (!validation.success) {
    return validationError(res, validation.error);
  }

  try {
    const { period, limit } = validation.data;
    const result = await getTopRedeemedProducts(period, limit);

    return successRequest({
      res,
      code: 200,
      message: "Dashboard top redeemed products retrieved successfully",
      data: result,
    });
  } catch (error) {
    return badRequest({
      res,
      code: 500,
      error: error.message,
    });
  }
}

async function getRecentTransactionsController(req, res) {
  const validation = recentTransactionsQuerySchema.safeParse(req.query);

  if (!validation.success) {
    return validationError(res, validation.error);
  }

  try {
    const result = await getRecentTransactions(validation.data);

    return successRequest({
      res,
      code: 200,
      message: "Dashboard recent transactions retrieved successfully",
      data: result,
    });
  } catch (error) {
    return badRequest({
      res,
      code: 500,
      error: error.message,
    });
  }
}

module.exports = {
  getTotalCountsController,
  getCustomersPerOutletController,
  getTopRedeemedProductsController,
  getRecentTransactionsController,
};
