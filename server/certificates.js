"use strict";

const crypto = require("node:crypto");

const BASE_CERTIFICATES = [
  {
    serial: "DVH-2026-78421",
    name: "Ahmed Ali",
    course: "Web Development Essentials",
    date: "2026-09-12",
    status: "valid",
  },
];

const VALID_STATUSES = new Set(["valid", "revoked", "expired"]);

function normalizePrefix(value) {
  return (
    String(value || "DVH")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 6) || "DVH"
  );
}

function normalizeDate(value, fallback = null) {
  const text = String(value || "").trim();
  if (!text) return fallback;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString().slice(0, 10);
}

function normalizeStatus(value, fallback = "valid") {
  const status = String(value || fallback).toLowerCase();
  return VALID_STATUSES.has(status) ? status : fallback;
}

function generateSerial(prefix = "DVH", now = new Date()) {
  const safePrefix = normalizePrefix(prefix);
  const year = now.getUTCFullYear();
  const randomPart = crypto.randomInt(10000000, 100000000);
  return safePrefix + "-" + year + "-" + String(randomPart);
}

function normalizeCertificate(input, { requireSerial = true } = {}) {
  if (!input || typeof input !== "object") return null;

  const serial = String(input.serial || "").trim().toUpperCase();
  const name = String(input.name || "").trim();
  const course = String(input.course || "").trim();
  const date = normalizeDate(input.date, new Date().toISOString().slice(0, 10));
  const expiresAt = normalizeDate(input.expiresAt, null);
  const status = normalizeStatus(input.status);
  const revokedReason = String(input.revokedReason || "").trim();

  if ((requireSerial && !serial) || !name || !course || !date) return null;
  if (serial && !/^[A-Z0-9-]{6,40}$/.test(serial)) return null;

  const certificate = {
    ...(serial ? { serial } : {}),
    name: name.slice(0, 120),
    course: course.slice(0, 160),
    date,
    status,
    ...(expiresAt ? { expiresAt } : {}),
  };

  if (revokedReason) {
    certificate.revokedReason = revokedReason.slice(0, 500);
  }

  if (input.pdf && /^https?:\/\//i.test(String(input.pdf))) {
    certificate.pdf = String(input.pdf).slice(0, 2048);
  }

  return certificate;
}

function normalizeCertificatePatch(input) {
  if (!input || typeof input !== "object") return null;

  const patch = {};

  if ("name" in input) {
    const value = String(input.name || "").trim();
    if (!value) return null;
    patch.name = value.slice(0, 120);
  }

  if ("course" in input) {
    const value = String(input.course || "").trim();
    if (!value) return null;
    patch.course = value.slice(0, 160);
  }

  if ("date" in input) {
    const value = normalizeDate(input.date, null);
    if (!value) return null;
    patch.date = value;
  }

  if ("expiresAt" in input) {
    if (input.expiresAt === null || input.expiresAt === "") {
      patch.expiresAt = null;
    } else {
      const value = normalizeDate(input.expiresAt, null);
      if (!value) return null;
      patch.expiresAt = value;
    }
  }

  if ("status" in input) {
    const value = String(input.status || "").toLowerCase();
    if (!VALID_STATUSES.has(value)) return null;
    patch.status = value;
  }

  if ("revokedReason" in input) {
    patch.revokedReason = String(input.revokedReason || "").trim().slice(0, 500);
  }

  if ("pdf" in input) {
    if (input.pdf === null || input.pdf === "") {
      patch.pdf = null;
    } else if (/^https?:\/\//i.test(String(input.pdf))) {
      patch.pdf = String(input.pdf).slice(0, 2048);
    } else {
      return null;
    }
  }

  return Object.keys(patch).length ? patch : null;
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

module.exports = {
  BASE_CERTIFICATES,
  VALID_STATUSES,
  generateSerial,
  normalizePrefix,
  normalizeDate,
  normalizeStatus,
  normalizeCertificate,
  normalizeCertificatePatch,
  parseRequestBody,
  isDemoMode,
};
