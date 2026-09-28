// Retry untuk request ke Runchise yang gagal karena error transien
// (jaringan/timeout, 429, 5xx).
const axios = require("axios");

const RUNCHISE_MAX_RETRIES = 3;
const RUNCHISE_RETRY_BASE_DELAY_MS = 1_000;
const RUNCHISE_RETRY_MAX_DELAY_MS = 30_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Beberapa fungsi di runchise.service membungkus AxiosError ke dalam `cause`,
// sedangkan yang lain melempar AxiosError apa adanya.
function getAxiosError(error) {
  if (axios.isAxiosError(error)) return error;
  if (axios.isAxiosError(error?.cause)) return error.cause;
  return null;
}

// Hanya error jaringan/timeout, 429, dan 5xx yang layak diulang; 4xx lain
// (mis. transaksi tidak ditemukan) akan gagal lagi dengan hasil yang sama.
function isTransientRunchiseError(error) {
  const axiosError = getAxiosError(error);
  if (!axiosError) return false;
  const status = axiosError.response?.status;
  return status === undefined || status === 429 || status >= 500;
}

function getRetryDelayMs(error, attempt) {
  const retryAfterSeconds = Number(
    getAxiosError(error)?.response?.headers?.["retry-after"],
  );
  const backoff = RUNCHISE_RETRY_BASE_DELAY_MS * 2 ** attempt;
  const delay = Number.isFinite(retryAfterSeconds)
    ? Math.max(backoff, retryAfterSeconds * 1_000)
    : backoff;
  return Math.min(delay, RUNCHISE_RETRY_MAX_DELAY_MS);
}

async function withRunchiseRetry(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= RUNCHISE_MAX_RETRIES || !isTransientRunchiseError(error)) {
        throw error;
      }
      await sleep(getRetryDelayMs(error, attempt));
    }
  }
}

module.exports = { withRunchiseRetry, isTransientRunchiseError };
