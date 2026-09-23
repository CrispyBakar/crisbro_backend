// Retry singkat untuk error koneksi database yang transien (mis. Supavisor
// menutup koneksi pool di tengah query) agar job sync tidak kehilangan record.
const TRANSIENT_DB_ERROR_CODES = new Set([
  "P1001", // database tidak bisa dihubungi
  "P1002", // database tidak merespons
  "P1008", // operasi timeout
  "P1017", // server menutup koneksi
]);

function isTransientDbError(error) {
  if (!error) return false;
  if (TRANSIENT_DB_ERROR_CODES.has(error.code)) return true;
  return /server has closed the connection|connection terminated|connection error|timed out/i.test(
    error.message ?? "",
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withDbRetry(fn, { retries = 3, baseDelayMs = 300 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isTransientDbError(error)) throw error;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

module.exports = { withDbRetry, isTransientDbError };
