"use strict";

const STORAGE_KEY = "devshub:certificates:v2";
const LEGACY_STORAGE_KEY = "devshub:certificates";

function storageConfig() {
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

async function redisCommand(command) {
  const config = storageConfig();
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

async function listCertificates() {
  let certificates = [];

  try {
    const hash = await redisCommand(["HGETALL", STORAGE_KEY]);
    certificates = parseHashResult(hash);
  } catch (error) {
    if (error.code === "STORAGE_NOT_CONFIGURED") throw error;
  }

  if (certificates.length) return certificates;

  const legacy = await readLegacyCertificates();
  if (legacy.length) {
    for (const certificate of legacy) {
      if (certificate?.serial) {
        await upsertCertificate(certificate).catch(() => {});
      }
    }
  }
  return legacy;
}

async function getCertificate(serial) {
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

async function upsertCertificate(certificate) {
  await redisCommand([
    "HSET",
    STORAGE_KEY,
    certificate.serial,
    JSON.stringify(certificate),
  ]);
  return certificate;
}

module.exports = {
  storageConfig,
  listCertificates,
  getCertificate,
  upsertCertificate,
};
