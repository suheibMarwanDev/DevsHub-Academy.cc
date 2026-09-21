"use strict";

const {
  storageConfig,
  listCertificates,
  getCertificate,
  upsertCertificate,
} = require("./lib/storage");
const {
  BASE_CERTIFICATES,
  normalizeCertificate,
  parseRequestBody,
  isDemoMode,
  canWrite,
} = require("./lib/certificates");

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const serial = String(req.query?.serial || "").trim().toUpperCase();

      if (serial) {
        const certificate = await getCertificate(serial);
        const fallback =
          BASE_CERTIFICATES.find((item) => item.serial === serial) || null;

        return json(res, certificate || fallback ? 200 : 404, {
          certificate: certificate || fallback,
          storage: storageConfig().provider,
        });
      }

      const stored = await listCertificates();
      const certificates = stored.length ? stored : BASE_CERTIFICATES;

      return json(res, 200, {
        certificates,
        storage: storageConfig().provider,
        demoMode: isDemoMode(),
      });
    }

    if (req.method === "POST") {
      if (!canWrite(req)) {
        return json(res, 401, {
          error: "Admin authentication required",
        });
      }

      const cert = normalizeCertificate(parseRequestBody(req.body));
      if (!cert) {
        return json(res, 400, {
          error: "Invalid certificate payload",
        });
      }

      if (!storageConfig().configured) {
        return json(res, 503, {
          error: "Cloud storage is not configured",
          demoMode: true,
          note: "The frontend will continue using its local demo fallback.",
        });
      }

      await upsertCertificate(cert);
      return json(res, 200, {
        certificate: cert,
        storage: storageConfig().provider,
      });
    }

    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    if (error?.code === "STORAGE_NOT_CONFIGURED") {
      if (req.method === "GET") {
        return json(res, 200, {
          certificates: BASE_CERTIFICATES,
          storage: "demo",
          demoMode: true,
        });
      }

      return json(res, 503, {
        error: "Cloud storage is not configured",
      });
    }

    console.error("certificate_api_error", error);
    return json(res, 500, { error: "Storage request failed" });
  }
};
