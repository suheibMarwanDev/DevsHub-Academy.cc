"use strict";

const crypto = require("node:crypto");
const {
  databaseConfig,
  consumeRateLimit,
} = require("./database");

function requestOriginAllowed(req) {
  const origin = String(req.headers.origin || "").trim();
  if (!origin) return true;

  const host = String(
    req.headers["x-forwarded-host"] ||
      req.headers.host ||
      "",
  )
    .split(",")[0]
    .trim();

  if (!host) return false;

  try {
    const parsed = new URL(origin);
    return parsed.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

function clientIp(req) {
  const forwarded = String(
    req.headers["x-forwarded-for"] || "",
  )
    .split(",")[0]
    .trim();

  return (
    forwarded ||
    String(req.headers["x-real-ip"] || "").trim() ||
    String(req.socket?.remoteAddress || "").trim() ||
    "unknown"
  );
}

function hashedClientKey(req, namespace) {
  const salt =
    String(process.env.RATE_LIMIT_SALT || "").trim() ||
    "devshub-development-rate-limit-salt";

  return (
    namespace +
    ":" +
    crypto
      .createHmac("sha256", salt)
      .update(clientIp(req))
      .digest("hex")
  );
}

async function allowRateLimitedRequest(
  req,
  namespace,
  limit,
  windowSeconds,
) {
  if (!databaseConfig().configured) return true;

  try {
    return await consumeRateLimit(
      hashedClientKey(req, namespace),
      limit,
      windowSeconds,
    );
  } catch (error) {
    console.error("rate_limit_error", error);
    // Fail open so a temporary analytics/rate-limit failure does not
    // take certificate verification offline.
    return true;
  }
}

function applyApiSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader(
    "Permissions-Policy",
    "camera=(self), microphone=(), geolocation=()",
  );
}

module.exports = {
  requestOriginAllowed,
  allowRateLimitedRequest,
  applyApiSecurityHeaders,
  hashedClientKey,
};
