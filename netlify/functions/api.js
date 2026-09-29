// Netlify Function yang membungkus seluruh aplikasi Express. netlify.toml
// mengarahkan semua request (/*) ke sini, sehingga route tetap /api/... seperti
// saat dijalankan lokal.
const serverless = require("serverless-http");
const app = require("../../src/index");

module.exports.handler = serverless(app, {
  // Rewrite Netlify bisa meneruskan path asli (/api/login) atau path function
  // (/.netlify/functions/api/api/login). Prefix function dibuang bila ada.
  basePath: "/.netlify/functions/api",
  request(req, event) {
    // serverless-http menulis `req.ip` langsung dari event.requestContext,
    // sehingga `trust proxy` Express tidak berlaku. Rate limit dan sesi memakai
    // req.ip; tanpa baris ini semua user bisa terbaca sebagai satu IP (atau
    // undefined) dan saling menghabiskan kuota login. Netlify menaruh IP klien
    // asli di header x-nf-client-connection-ip.
    const clientIp = (event.headers || {})["x-nf-client-connection-ip"];
    if (clientIp) req.ip = clientIp;
  },
});
