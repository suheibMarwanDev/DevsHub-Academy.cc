"use strict";

const { storageConfig } = require("./lib/storage");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    return res.end();
  }

  const storage = storageConfig();

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
      demoMode:
        String(process.env.DEMO_MODE || "true").toLowerCase() !== "false",
    }),
  );
};
