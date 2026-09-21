"use strict";

const { getCertificate } = require("../lib/storage");
const { createSignedUrl } = require("../lib/file-storage");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    return res.end();
  }

  try {
    const serial = String(req.query?.serial || "").trim().toUpperCase();
    if (!serial) {
      res.statusCode = 400;
      return res.end("Certificate serial is required");
    }

    const certificate = await getCertificate(serial);
    if (!certificate) {
      res.statusCode = 404;
      return res.end("Certificate not found");
    }

    if (certificate.pdfPath) {
      const signedUrl = await createSignedUrl(certificate.pdfPath, 600);
      if (!signedUrl) {
        res.statusCode = 404;
        return res.end("Certificate file not found");
      }

      res.statusCode = 302;
      res.setHeader("Location", signedUrl);
      res.setHeader("Cache-Control", "private, no-store");
      return res.end();
    }

    if (certificate.pdf && /^https?:\/\//i.test(certificate.pdf)) {
      res.statusCode = 302;
      res.setHeader("Location", certificate.pdf);
      res.setHeader("Cache-Control", "private, no-store");
      return res.end();
    }

    res.statusCode = 404;
    return res.end("Certificate file not found");
  } catch (error) {
    console.error("certificate_file_error", error);
    res.statusCode = 500;
    return res.end("Unable to open certificate file");
  }
};
