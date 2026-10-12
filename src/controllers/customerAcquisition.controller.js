const {
  getCustomerAcquisition,
  createCustomerAcquisition,
  createMyCustomerAcquisition,
  CustomerAcquisitionError,
} = require("../services/customerAcquisition.service");
const {
  customerAcquisitionParamsSchema,
  createCustomerAcquisitionSchema,
  createMyCustomerAcquisitionSchema,
} = require("../validation/customerAcquisition/customerAcquisition-validation");
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

// Hanya CustomerAcquisitionError yang pesannya aman ditampilkan; error lain
// (Prisma) jangan diteruskan mentah ke client.
function respondAcquisitionError(res, error, context) {
  if (error instanceof CustomerAcquisitionError) {
    return badRequest({
      res,
      code: error.statusCode,
      error: error.message,
    });
  }

  return respondWithServerError(res, error, context);
}

async function createCustomerAcquisitionController(req, res) {
  const validation = createCustomerAcquisitionSchema.safeParse(req.body ?? {});

  if (!validation.success) {
    return validationError(res, validation.error);
  }

  try {
    const acquisition = await createCustomerAcquisition(validation.data);

    return successRequest({
      res,
      code: 201,
      message: "Customer acquisition created successfully",
      data: acquisition,
    });
  } catch (error) {
    return respondAcquisitionError(
      res,
      error,
      "Create customer acquisition failed",
    );
  }
}

async function createMyCustomerAcquisitionController(req, res) {
  // user_id selalu dari sesi login, bukan dari body, supaya customer tidak
  // bisa mengisi data akuisisi milik customer lain.
  const { user_id } = req.user ?? {};
  const validation = createMyCustomerAcquisitionSchema.safeParse(
    req.body ?? {},
  );

  if (!validation.success) {
    return validationError(res, validation.error);
  }

  try {
    const acquisition = await createMyCustomerAcquisition(
      user_id,
      validation.data,
    );

    return successRequest({
      res,
      code: 201,
      message: "Customer acquisition created successfully",
      data: acquisition,
    });
  } catch (error) {
    return respondAcquisitionError(
      res,
      error,
      "Create own customer acquisition failed",
    );
  }
}

async function getCustomerAcquisitionController(req, res) {
  const validation = customerAcquisitionParamsSchema.safeParse(req.params);

  if (!validation.success) {
    return validationError(res, validation.error);
  }

  try {
    const acquisition = await getCustomerAcquisition(
      validation.data.customer_id,
    );

    return successRequest({
      res,
      code: 200,
      message: "Customer acquisition retrieved successfully",
      data: acquisition,
    });
  } catch (error) {
    return respondAcquisitionError(
      res,
      error,
      "Get customer acquisition failed",
    );
  }
}

module.exports = {
  getCustomerAcquisitionController,
  createCustomerAcquisitionController,
  createMyCustomerAcquisitionController,
};
