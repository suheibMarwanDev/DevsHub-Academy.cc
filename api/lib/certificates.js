"use strict";

const BASE_CERTIFICATES = [
  {
    serial: "DVH-2026-78421",
    name: "Ahmed Ali",
    course: "Web Development Essentials",
    date: "12 Sep 2026",
    status: "valid",
  },
];

function normalizeCertificate(input) {
  if (!input || typeof input !== "object") return null;

  const serial = String(input.serial || "").trim().toUpperCase();
  const name = String(input.name || "").trim();
  const course = String(input.course || "").trim();
  const date = String(input.date || "").trim();
  const status = ["valid", "revoked", "expired"].includes(input.status)
    ? input.status
    : "valid";

  if (!serial || !name || !course || !date) return null;
  if (!/^[A-Z0-9-]{6,40}$/.test(serial)) return null;

  const certificate = {
    serial,
    name: name.slice(0, 120),
    course: course.slice(0, 160),
    date: date.slice(0, 60),
    status,
  };

  if (input.pdf && /^https?:\/\//i.test(String(input.pdf))) {
    certificate.pdf = String(input.pdf).slice(0, 2048);
  }

  return certificate;
}

function parseRequestBody(body) {
  if (!body) return null;
  if (typeof body === "object") return body;

  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function isDemoMode() {
  return String(process.env.DEMO_MODE || "true").toLowerCase() !== "false";
}

function canWrite(req) {
  if (isDemoMode()) return true;

  const expected = process.env.ADMIN_API_TOKEN || "";
  if (!expected) return false;

  const supplied =
    req.headers["x-admin-token"] ||
    String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  return supplied === expected;
}

module.exports = {
  BASE_CERTIFICATES,
  normalizeCertificate,
  parseRequestBody,
  isDemoMode,
  canWrite,
};
