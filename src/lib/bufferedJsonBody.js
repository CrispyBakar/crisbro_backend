// serverless-http (Netlify Functions) sudah membaca seluruh body dan
// menaruhnya sebagai Buffer di `req.body`, sekaligus menandai request selesai
// dibaca (`complete: true`). body-parser di Express 5 menganggap request
// seperti itu sudah diproses dan melewatinya, sehingga `req.body` tetap Buffer
// mentah dan semua field (mis. password saat login) terbaca undefined.
//
// Middleware ini dipasang setelah express.json() dan hanya bekerja bila body
// masih berupa Buffer, jadi tidak berpengaruh saat berjalan sebagai server
// biasa.
function createBufferedJsonBodyParser({ limitBytes }) {
  return function parseBufferedJsonBody(req, res, next) {
    if (!Buffer.isBuffer(req.body)) return next();

    const raw = req.body;
    // Samakan dengan express.json(): tanpa body JSON, req.body undefined.
    req.body = undefined;

    if (raw.length === 0 || !req.is("application/json")) return next();

    if (raw.length > limitBytes) {
      return res.status(413).json({ message: "Request body terlalu besar" });
    }

    try {
      req.body = JSON.parse(raw.toString("utf8"));
    } catch {
      return res.status(400).json({ message: "Body JSON tidak valid" });
    }

    return next();
  };
}

module.exports = { createBufferedJsonBodyParser };
