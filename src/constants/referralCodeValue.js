const DEFAULT_POINT_REWARD = 3;
const DEFAULT_POINT_GIVEN = 3;
const DEFAULT_EXPIRES_MONTHS = 6;

// Dihitung setiap dipanggil agar masa berlaku selalu 6 bulan sejak kode
// dibuat/diperpanjang, bukan sejak server dinyalakan.
function getDefaultExpiresTime(from = new Date()) {
  const expiresAt = new Date(from);
  expiresAt.setMonth(expiresAt.getMonth() + DEFAULT_EXPIRES_MONTHS);
  return expiresAt;
}

module.exports = {
  getDefaultExpiresTime,
  DEFAULT_POINT_REWARD,
  DEFAULT_POINT_GIVEN,
};
