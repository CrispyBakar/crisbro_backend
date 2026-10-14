const { z } = require("zod");
const {
  successRequest,
  badRequest,
  respondWithServerError,
} = require("../utils/responseReuest");
const {
  listAllCustomers,
  getCustomerById,
  getCustomerByUserId,
  updateCustomerById,
  listCustomerPointHistory,
  changeStatusCustomer,
  adjustPointCustomer,
  generateAllCustomerRunchise,
  updateAllCustomerPointHistory,
  syncronizeCustomerRunchise,
} = require("../services/customer.service");
const {
  updateCustomerSchema,
  deactivateCustomerSchema,
  adjustPointSchema,
} = require("../validation/customer/customer-validation");
const { isAmbiguousRunchiseError } = require("../lib/runchiseRetry");

const uuidSchema = z.string().uuid("ID must be a valid UUID");
const listCustomersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  search: z.string().default(""),
  sort_by: z
    .enum([
      "created_at",
      "name",
      "phone_number",
      "status",
      "available_point",
      "total_point",
    ])
    .default("created_at"),
  sort_order: z.enum(["asc", "desc"]).default("desc"),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});
const updateMyCustomerSchema = updateCustomerSchema.omit({
  status: true,
  last_updated_by_id: true,
  owner_location_id: true,
});
const listPointHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  point_type: z.string().trim().min(1).optional(),
  sort_by: z
    .enum(["formatted_created_at", "issued_at_time"])
    .default("formatted_created_at"),
  sort_order: z.enum(["asc", "desc"]).default("desc"),
});

function validationError(res, error) {
  return badRequest({
    res,
    code: 422,
    error: error.flatten().fieldErrors,
  });
}

async function listCustomers(req, res) {
  const validation = listCustomersQuerySchema.safeParse(req.query);

  if (!validation.success) {
    return validationError(res, validation.error);
  }

  try {
    const result = await listAllCustomers(validation.data);

    return successRequest({
      res,
      data: result,
      message: "Customers retrieved successfully.",
    });
  } catch (error) {
    return respondWithServerError(res, error, "List customers failed");
  }
}

async function getCustomer(req, res) {
  const validation = uuidSchema.safeParse(req.params.customer_id);

  if (!validation.success) {
    return validationError(res, validation.error);
  }

  try {
    const customer = await getCustomerById(validation.data);

    if (!customer) {
      return badRequest({ res, code: 404, error: "Customer not found" });
    }

    return successRequest({
      res,
      data: customer,
      message: "Customer retrieved successfully.",
    });
  } catch (error) {
    return respondWithServerError(res, error, "Get customer failed");
  }
}

async function getCustomerByUser(req, res) {
  const validation = uuidSchema.safeParse(req.params.user_id);

  if (!validation.success) {
    return validationError(res, validation.error);
  }

  try {
    const customer = await getCustomerByUserId(validation.data);

    if (!customer) {
      return badRequest({ res, code: 404, error: "Customer not found" });
    }

    return successRequest({
      res,
      data: customer,
      message: "Customer retrieved successfully.",
    });
  } catch (error) {
    return respondWithServerError(res, error, "Get customer by user failed");
  }
}

async function updateCustomer(req, res) {
  const idValidation = uuidSchema.safeParse(req.params.customer_id);

  if (!idValidation.success) {
    return validationError(res, idValidation.error);
  }

  const payload = {
    ...(req.body ?? {}),
    ...(req.user?.user_id ? { last_updated_by_id: req.user.user_id } : {}),
  };
  const bodyValidation = updateCustomerSchema.safeParse(payload);

  if (!bodyValidation.success) {
    return validationError(res, bodyValidation.error);
  }

  if (Object.keys(bodyValidation.data).length === 0) {
    return badRequest({
      res,
      code: 422,
      error: "At least one field must be provided",
    });
  }

  try {
    const customer = await updateCustomerById(
      idValidation.data,
      bodyValidation.data,
    );

    return successRequest({
      res,
      data: customer,
      message: "Customer updated successfully.",
    });
  } catch (error) {
    if (error.message === "Customer not found") {
      return badRequest({ res, code: 404, error: error.message });
    }

    if (error.message === "Phone number is already registered") {
      return badRequest({ res, code: 409, error: error.message });
    }

    if (error.message === "Email is already registered") {
      return badRequest({ res, code: 409, error: error.message });
    }

    if (error.message === "Owner location not found") {
      return badRequest({ res, code: 404, error: error.message });
    }

    if (
      error.message === "No valid fields to update" ||
      error.message === "No valid Runchise fields to update" ||
      error.message ===
        "Customer belum terhubung ke Runchise, tidak bisa update"
    ) {
      return badRequest({ res, code: 422, error: error.message });
    }

    return respondWithServerError(res, error, "Update customer failed");
  }
}

async function changeCustomerStatus(req, res) {
  const idValidation = uuidSchema.safeParse(req.params.customer_id);

  if (!idValidation.success) {
    return validationError(res, idValidation.error);
  }

  const bodyValidation = deactivateCustomerSchema.safeParse(req.body ?? {});

  if (!bodyValidation.success) {
    return validationError(res, bodyValidation.error);
  }

  try {
    const customer = await changeStatusCustomer(
      idValidation.data,
      bodyValidation.data.status,
    );

    return successRequest({
      res,
      data: customer,
      message: "Customer status updated successfully.",
    });
  } catch (error) {
    if (error.message === "Customer not found.") {
      return badRequest({ res, code: 404, error: error.message });
    }

    if (
      error.message ===
      "Customer belum terhubung ke Runchise, tidak bisa update"
    ) {
      return badRequest({ res, code: 422, error: error.message });
    }

    return respondWithServerError(res, error, "Change customer status failed");
  }
}

async function adjustCustomerPoint(req, res) {
  const idValidation = uuidSchema.safeParse(req.params.customer_id);

  if (!idValidation.success) {
    return validationError(res, idValidation.error);
  }

  const bodyValidation = adjustPointSchema.safeParse(req.body ?? {});

  if (!bodyValidation.success) {
    return validationError(res, bodyValidation.error);
  }

  try {
    const { customer, synced } = await adjustPointCustomer(
      idValidation.data,
      bodyValidation.data,
    );

    return successRequest({
      res,
      data: { customer, synced },
      message: synced
        ? "Customer point adjusted successfully."
        : "Poin sudah diubah di Runchise, tapi saldo lokal belum tersinkron. Jangan ulangi adjust; saldo akan diperbarui oleh sinkron harian.",
    });
  } catch (error) {
    if (error.message === "Customer not found") {
      return badRequest({ res, code: 404, error: error.message });
    }

    if (
      error.message === "Poin customer tidak mencukupi" ||
      error.message ===
        "Customer belum terhubung ke Runchise, tidak bisa update"
    ) {
      return badRequest({ res, code: 422, error: error.message });
    }

    if (error.code === "RUNCHISE_REQUEST_FAILED") {
      // Timeout/5xx: Runchise mungkin sudah memproses adjust, jadi admin
      // harus cek riwayat poin dulu sebelum mencoba lagi
      if (isAmbiguousRunchiseError(error)) {
        return badRequest({
          res,
          code: 502,
          error:
            "Runchise tidak merespons dengan jelas. Cek riwayat poin customer sebelum mencoba lagi agar poin tidak terhitung dua kali.",
        });
      }

      // 4xx dari Runchise (mis. payload ditolak): adjust pasti tidak terjadi
      if (error.cause?.response?.status < 500) {
        return badRequest({ res, code: 422, error: error.message });
      }
    }

    return respondWithServerError(res, error, "Adjust customer point failed");
  }
}

async function getMyCustomer(req, res) {
  try {
    const customer = await getCustomerByUserId(req.user.user_id);

    if (!customer) {
      return badRequest({ res, code: 404, error: "Customer not found" });
    }

    return successRequest({
      res,
      data: customer,
      message: "Customer profile retrieved successfully.",
    });
  } catch (error) {
    return respondWithServerError(
      res,
      error,
      "Get own customer profile failed",
    );
  }
}

async function updateMyCustomer(req, res) {
  const validation = updateMyCustomerSchema.safeParse(req.body ?? {});

  if (!validation.success) {
    return validationError(res, validation.error);
  }

  if (Object.keys(validation.data).length === 0) {
    return badRequest({
      res,
      code: 422,
      error: "At least one field must be provided",
    });
  }

  try {
    const customer = await getCustomerByUserId(req.user.user_id);

    if (!customer) {
      return badRequest({ res, code: 404, error: "Customer not found" });
    }

    const updatedCustomer = await updateCustomerById(customer.customer_id, {
      ...validation.data,
      last_updated_by_id: req.user.user_id,
    });

    return successRequest({
      res,
      data: updatedCustomer,
      message: "Customer profile updated successfully.",
    });
  } catch (error) {
    if (error.message === "Customer not found") {
      return badRequest({ res, code: 404, error: error.message });
    }

    if (error.message === "Phone number is already registered") {
      return badRequest({ res, code: 409, error: error.message });
    }

    if (error.message === "Email is already registered") {
      return badRequest({ res, code: 409, error: error.message });
    }

    if (error.message === "Owner location not found") {
      return badRequest({ res, code: 404, error: error.message });
    }

    if (
      error.message === "No valid fields to update" ||
      error.message === "No valid Runchise fields to update" ||
      error.message ===
        "Customer belum terhubung ke Runchise, tidak bisa update"
    ) {
      return badRequest({ res, code: 422, error: error.message });
    }

    return respondWithServerError(
      res,
      error,
      "Update own customer profile failed",
    );
  }
}

async function getCustomerPointHistory(req, res) {
  const idValidation = uuidSchema.safeParse(req.params.customer_id);

  if (!idValidation.success) {
    return validationError(res, idValidation.error);
  }

  const queryValidation = listPointHistoryQuerySchema.safeParse(req.query);

  if (!queryValidation.success) {
    return validationError(res, queryValidation.error);
  }

  try {
    const customer = await getCustomerById(idValidation.data);

    if (!customer) {
      return badRequest({ res, code: 404, error: "Customer not found" });
    }

    const result = await listCustomerPointHistory(
      idValidation.data,
      queryValidation.data,
    );

    return successRequest({
      res,
      data: result,
      message: "Customer point history retrieved successfully.",
    });
  } catch (error) {
    return respondWithServerError(
      res,
      error,
      "List customer point history failed",
    );
  }
}

async function getMyPointHistory(req, res) {
  const queryValidation = listPointHistoryQuerySchema.safeParse(req.query);

  if (!queryValidation.success) {
    return validationError(res, queryValidation.error);
  }

  try {
    const customer = await getCustomerByUserId(req.user.user_id);

    if (!customer) {
      return badRequest({ res, code: 404, error: "Customer not found" });
    }

    const result = await listCustomerPointHistory(
      customer.customer_id,
      queryValidation.data,
    );

    return successRequest({
      res,
      data: result,
      message: "Point history retrieved successfully.",
    });
  } catch (error) {
    return respondWithServerError(res, error, "List own point history failed");
  }
}

// Menarik seluruh customer berpoin dari Runchise lalu menyimpannya ke tabel
// Customer lokal. Proses bisa berjalan lama karena menarik banyak halaman
// dari API Runchise; ringkasan hasil dikembalikan pada response.
async function generateCustomers(req, res) {
  try {
    const summary = await generateAllCustomerRunchise();

    return successRequest({
      res,
      data: summary,
      message: "Customers berhasil digenerate dari Runchise.",
    });
  } catch (error) {
    // Kegagalan umumnya berasal dari API Runchise (timeout/network) atau
    // database; context generate memudahkan pelacakan di log.
    return respondWithServerError(res, error, "Generate customers failed");
  }
}

async function generateAllCustomerPoint(req, res) {
  try {
    const summary = await updateAllCustomerPointHistory();

    return successRequest({
      res,
      data: summary,
      message: "Customer points berhasil digenerate dari Runchise",
    });
  } catch (error) {
    return respondWithServerError(
      res,
      error,
      "Generate customers points failed",
    );
  }
}

// Menarik data terbaru satu customer dari Runchise (profil, status, poin,
// saldo) lalu menimpa data lokalnya.
async function syncCustomer(req, res) {
  const validation = uuidSchema.safeParse(req.params.customer_id);

  if (!validation.success) {
    return validationError(res, validation.error);
  }

  try {
    const customer = await syncronizeCustomerRunchise(validation.data);

    return successRequest({
      res,
      data: customer,
      message: "Customer berhasil disinkronkan dari Runchise.",
    });
  } catch (error) {
    if (error.message === "Customer not found") {
      return badRequest({ res, code: 404, error: error.message });
    }

    if (
      error.message ===
      "Customer belum terhubung ke Runchise, tidak bisa update"
    ) {
      return badRequest({ res, code: 422, error: error.message });
    }

    if (error.code === "RUNCHISE_REQUEST_FAILED") {
      return badRequest({ res, code: 502, error: error.message });
    }

    return respondWithServerError(res, error, "Sync customer failed");
  }
}

module.exports = {
  listCustomers,
  getCustomer,
  getCustomerByUser,
  updateCustomer,
  changeCustomerStatus,
  adjustCustomerPoint,
  getMyCustomer,
  updateMyCustomer,
  getCustomerPointHistory,
  generateAllCustomerPoint,
  getMyPointHistory,
  generateCustomers,
  syncCustomer,
};
