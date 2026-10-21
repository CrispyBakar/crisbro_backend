const busboy = require("busboy");
const { badRequest } = require("../utils/responseReuest");

// Parser multipart/form-data untuk satu file gambar yang disimpan di memori.
// Field teks masuk ke `req.body`, file masuk ke `req.file`
// ({ buffer, mime_type, filename, size }).
//
// Saat berjalan sebagai server biasa body dibaca dari stream request. Di
// Netlify Functions stream sudah habis dibaca serverless-http, sehingga busboy
// diberi Buffer `req.rawBody` (lihat src/lib/bufferedJsonBody.js).
function imageUpload({ fieldName, maxBytes, allowedMimeTypes }) {
  return function parseImageUpload(req, res, next) {
    if (!req.is("multipart/form-data")) {
      return badRequest({
        res,
        code: 415,
        error: "Content-Type harus multipart/form-data",
      });
    }

    let parser;
    try {
      parser = busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: maxBytes, fields: 20 },
      });
    } catch {
      return badRequest({ res, code: 400, error: "Body multipart tidak valid" });
    }

    const fields = {};
    let file = null;
    let uploadError = null;
    let finished = false;

    function finish(error) {
      if (finished) return;
      finished = true;

      const failure = error || uploadError;
      if (failure) {
        return badRequest({ res, code: failure.code, error: failure.error });
      }

      req.body = fields;
      req.file = file;
      return next();
    }

    parser.on("field", (name, value) => {
      fields[name] = value;
    });

    parser.on("file", (name, stream, info) => {
      if (name !== fieldName || uploadError) {
        stream.resume();
        return;
      }

      if (!allowedMimeTypes.includes(info.mimeType)) {
        uploadError = {
          code: 422,
          error: {
            [fieldName]: [`Format harus ${allowedMimeTypes.join(", ")}`],
          },
        };
        stream.resume();
        return;
      }

      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("limit", () => {
        uploadError = {
          code: 413,
          error: `Ukuran ${fieldName} maksimal ${maxBytes / (1024 * 1024)} MB`,
        };
      });
      stream.on("end", () => {
        if (uploadError) return;
        const buffer = Buffer.concat(chunks);
        file = {
          buffer,
          mime_type: info.mimeType,
          filename: info.filename,
          size: buffer.length,
        };
      });
    });

    parser.on("error", () =>
      finish({ code: 400, error: "Body multipart tidak valid" }),
    );
    parser.on("close", () => finish());

    if (Buffer.isBuffer(req.rawBody)) {
      parser.end(req.rawBody);
    } else {
      req.pipe(parser);
    }
  };
}

module.exports = { imageUpload };
