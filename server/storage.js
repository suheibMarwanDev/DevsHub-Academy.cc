"use strict";

const {
  databaseConfig,
  listDatabaseCertificates,
  getDatabaseCertificate,
  createDatabaseCertificate,
  updateDatabaseCertificate,
  upsertDatabaseCertificate,
} = require("./database");

const STORAGE_KEY = "devshub:certificates:v2";
const LEGACY_STORAGE_KEY = "devshub:certificates";

function redisConfig() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    "";

  return {
    url: url.replace(/\/$/, ""),
    token,
    configured: Boolean(url && token),
  };
}

function storageConfig() {
  const database = databaseConfig();
  const redis = redisConfig();

  if (database.configured) {
    return { configured: true, provider: "postgresql" };
  }

  if (redis.configured) {
    return { configured: true, provider: "redis" };
  }

  return { configured: false, provider: "demo" };
}

async function redisCommand(command) {
  const config = redisConfig();
  if (!config.configured) {
    const error = new Error("Cloud storage is not configured");
    error.code = "STORAGE_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch(config.url + "/pipeline", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + config.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([command]),
  });

  if (!response.ok) {
    throw new Error("Cloud storage request failed");
  }

  const payload = await response.json();
  const result = payload?.[0];

  if (result?.error) {
    const error = new Error(result.error);
    error.code = "REDIS_ERROR";
    throw error;
  }

  return result?.result;
}

function parseHashResult(result) {
  if (!result) return [];

  if (Array.isArray(result)) {
    const values = [];
    for (let index = 1; index < result.length; index += 2) {
      try {
        values.push(JSON.parse(result[index]));
      } catch {}
    }
    return values;
  }

  if (typeof result === "object") {
    return Object.values(result)
      .map((value) => {
        try {
          return typeof value === "string" ? JSON.parse(value) : value;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  return [];
}

async function readLegacyCertificates() {
  try {
    const raw = await redisCommand(["GET", LEGACY_STORAGE_KEY]);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function listRedisCertificates({ q = "", status = "", limit = 100 } = {}) {
  let certificates = [];

  try {
    certificates = parseHashResult(
      await redisCommand(["HGETALL", STORAGE_KEY]),
    );
  } catch (error) {
    if (error.code === "STORAGE_NOT_CONFIGURED") throw error;
  }

  if (!certificates.length) {
    certificates = await readLegacyCertificates();
  }

  const search = String(q || "").trim().toLowerCase();
  const normalizedStatus = String(status || "").trim().toLowerCase();

  return certificates
    .filter((certificate) => {
      if (
        normalizedStatus &&
        String(certificate.status || "valid").toLowerCase() !== normalizedStatus
      ) {
        return false;
      }

      if (!search) return true;

      return [certificate.serial, certificate.name, certificate.course]
        .join(" ")
        .toLowerCase()
        .includes(search);
    })
    .slice(0, Math.min(Math.max(Number(limit) || 100, 1), 500));
}

async function getRedisCertificate(serial) {
  const normalized = String(serial || "").trim().toUpperCase();
  if (!normalized) return null;

  const raw = await redisCommand(["HGET", STORAGE_KEY, normalized]);
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {}
  }

  const legacy = await readLegacyCertificates();
  return (
    legacy.find(
      (certificate) =>
        String(certificate?.serial || "").toUpperCase() === normalized,
    ) || null
  );
}

async function createRedisCertificate(certificate) {
  const existing = await getRedisCertificate(certificate.serial);
  if (existing) {
    const error = new Error("Certificate serial already exists");
    error.code = "STORAGE_CONFLICT";
    throw error;
  }

  await redisCommand([
    "HSET",
    STORAGE_KEY,
    certificate.serial,
    JSON.stringify(certificate),
  ]);

  return certificate;
}

async function updateRedisCertificate(serial, patch) {
  const existing = await getRedisCertificate(serial);
  if (!existing) return null;

  const updated = {
    ...existing,
    ...patch,
    serial: existing.serial,
  };

  if (updated.status === "revoked") {
    updated.revokedAt = updated.revokedAt || new Date().toISOString();
  } else {
    delete updated.revokedAt;
    delete updated.revokedReason;
  }

  await redisCommand([
    "HSET",
    STORAGE_KEY,
    existing.serial,
    JSON.stringify(updated),
  ]);

  return updated;
}

async function upsertRedisCertificate(certificate) {
  const existing = await getRedisCertificate(certificate.serial);
  if (!existing) return createRedisCertificate(certificate);

  return updateRedisCertificate(certificate.serial, certificate);
}

async function listCertificates(options = {}) {
  if (databaseConfig().configured) {
    return listDatabaseCertificates(options);
  }

  return listRedisCertificates(options);
}

async function getCertificate(serial, options = {}) {
  if (databaseConfig().configured) {
    return getDatabaseCertificate(serial, options);
  }

  return getRedisCertificate(serial);
}

async function createCertificate(certificate, options = {}) {
  if (databaseConfig().configured) {
    return createDatabaseCertificate(certificate, options);
  }

  return createRedisCertificate(certificate);
}

async function updateCertificate(serial, patch, options = {}) {
  if (databaseConfig().configured) {
    return updateDatabaseCertificate(serial, patch, options);
  }

  return updateRedisCertificate(serial, patch);
}

async function upsertCertificate(certificate, options = {}) {
  if (databaseConfig().configured) {
    return upsertDatabaseCertificate(certificate, options);
  }

  return upsertRedisCertificate(certificate);
}

module.exports = {
  storageConfig,
  listCertificates,
  getCertificate,
  createCertificate,
  updateCertificate,
  upsertCertificate,
};
