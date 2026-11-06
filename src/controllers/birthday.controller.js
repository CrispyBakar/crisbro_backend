const {
  getMyBirthdayTreat,
  claimCustomerBirthdayTreat,
} = require("../services/birthday.service");
const {
  successRequest,
  badRequest,
  respondWithServerError,
} = require("../utils/responseReuest");

// Cek apakah customer yang sedang login punya birthday treat yang belum
// di-claim. Dipanggil frontend setelah login untuk memunculkan popup claim
// voucher ulang tahun bila has_claimable_treat = true.
async function getMyBirthdayTreatController(req, res) {
  // user_id selalu dari sesi login, bukan dari body/query.
  const { user_id } = req.user ?? {};

  if (!user_id) {
    return badRequest({ res, code: 401, error: "Unauthorized" });
  }

  try {
    const result = await getMyBirthdayTreat(user_id);

    return successRequest({
      res,
      code: 200,
      message: "Birthday treat checked successfully",
      data: result,
    });
  } catch (error) {
    return respondWithServerError(res, error, "Check birthday treat failed");
  }
}

async function claimCustomerBirthdayTreatController(req, res) {
  const { user_id } = req.user ?? {};

  if (!user_id) {
    return badRequest({ res, code: 401, error: "Unauthorized" });
  }

  try {
    const treat = await claimCustomerBirthdayTreat(user_id);

    return successRequest({
      res,
      code: 200,
      message: "Birthday treat claimed successfully",
      data: treat,
    });
  } catch (error) {
    return respondWithServerError(res, error, "Claim birthday treat failed");
  }
}

module.exports = {
  getMyBirthdayTreatController,
  claimCustomerBirthdayTreatController,
};
