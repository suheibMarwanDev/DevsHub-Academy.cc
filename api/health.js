"use strict";

const { storageConfig } = require("../server/storage");
const { authConfig, isDemoMode } = require("../server/auth");
const { fileStorageConfig } = require("../server/file-storage");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    return res.end();
  }

  const storage = storageConfig();
  const auth = authConfig();
  const files = fileStorageConfig();

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(
    JSON.stringify({
      ok: true,
      service: "devshub-academy",
      storageConfigured: storage.configured,
      storageProvider: storage.provider,
      authenticationConfigured: auth.configured,
      fileStorageConfigured: files.configured,
      fileStorageBucket: files.bucket,
      demoMode: isDemoMode(),
    }),
  );
};
