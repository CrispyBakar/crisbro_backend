const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'crisbar_session';
const SAME_SITE_VALUES = ['strict', 'lax', 'none'];

function parseCookies(header = '') {
  return String(header).split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator < 1) return cookies;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      // Cookie dengan encoding rusak bukan kredensial yang valid.
    }
    return cookies;
  }, {});
}

function getSessionCookie(req) {
  return parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME] || null;
}

// Frontend dan backend berada di domain berbeda (mis. crisbro.netlify.app dan
// crisbrobackend.netlify.app; netlify.app ada di Public Suffix List sehingga
// keduanya dianggap beda site). Cookie yang di-set dari respons fetch lintas
// site hanya diterima browser bila SameSite=None; Secure. Dulu mode ini hanya
// aktif bila NODE_ENV=production, sehingga deploy tanpa env itu mengirim
// SameSite=Strict tanpa Secure dan browser diam-diam menolak cookie login.
//
// Sekarang ditentukan dari request itu sendiri: request HTTPS (deployment)
// memakai None + Secure, request HTTP (development lokal, frontend dan backend
// sama-sama localhost = satu site) memakai Strict.
function isHttpsRequest(req) {
  return Boolean(req && req.secure);
}

function resolveSameSite(req) {
  const configured = String(process.env.SESSION_COOKIE_SAME_SITE || '').toLowerCase();
  if (SAME_SITE_VALUES.includes(configured)) return configured;

  return process.env.NODE_ENV === 'production' || isHttpsRequest(req)
    ? 'none'
    : 'strict';
}

function cookieOptions(req, expiresAt) {
  const sameSite = resolveSameSite(req);
  // SameSite=None wajib Secure; tanpa itu browser menolak cookie.
  const secure =
    sameSite === 'none' ||
    process.env.NODE_ENV === 'production' ||
    isHttpsRequest(req);

  return {
    httpOnly: true,
    secure,
    sameSite,
    // Browser yang memblokir third-party cookie (mode incognito Chrome, Brave,
    // dll.) masih menerima cookie Partitioned (CHIPS). Frontend selalu jadi
    // top-level site yang sama, jadi partisi tidak mengubah perilaku sesi.
    partitioned: sameSite === 'none' && process.env.SESSION_COOKIE_PARTITIONED !== 'false',
    path: '/api',
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}

function setSessionCookie(res, token, expiresAt) {
  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions(res.req, expiresAt));
}

// Atribut harus sama dengan saat cookie di-set (termasuk Partitioned), kalau
// tidak browser menganggapnya cookie lain dan cookie lama tidak terhapus.
function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, cookieOptions(res.req));
}

module.exports = {
  getSessionCookie,
  setSessionCookie,
  clearSessionCookie,
  cookieOptions,
};
