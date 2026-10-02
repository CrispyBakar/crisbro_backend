const crypto = require("crypto");

const GENERIC_MESSAGE =
  "Terjadi kesalahan pada server. Sebutkan kode error berikut bila menghubungi admin.";

function httpStatusOf(error) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : 500;
}

// Detail error (pesan Prisma, query, host database, stack) hanya masuk log.
// Client cukup menerima pesan generik dan error_id untuk dicocokkan dengan log.
// Pengecualian: error 4xx yang ditandai `expose` (konvensi http-errors, mis.
// JSON body tidak valid atau body terlalu besar) aman ditampilkan apa adanya.
function respondWithServerError(res, error, context = "Unhandled error") {
  const errorId = crypto.randomBytes(4).toString("hex");
  const status = httpStatusOf(error);
  const isClientError = status < 500 && error?.expose === true;

  if (isClientError) {
    console.warn(`[error:${errorId}] ${context}: ${status} ${error.message}`);
    return res.status(status).json({ message: error.message, error_id: errorId });
  }

  console.error(`[error:${errorId}] ${context}:`, error);

  // 4xx tanpa `expose` dianggap bug server agar detailnya tidak bocor.
  return res.status(status >= 500 ? status : 500).json({
    message: GENERIC_MESSAGE,
    error_id: errorId,
  });
}

module.exports = { respondWithServerError, GENERIC_MESSAGE };
