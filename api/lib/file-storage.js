"use strict";

const crypto = require("node:crypto");
const { databaseConfig } = require("./database");

const DEFAULT_BUCKET = "devshub-assets";

const FILE_RULES = {
  certificate: {
    maxBytes: 2500000,
    mimeTypes: new Set(["application/pdf"]),
  },
  logo: {
    maxBytes: 1500000,
    mimeTypes: new Set(["image/png", "image/jpeg", "image/webp"]),
  },
  template: {
    maxBytes: 2500000,
    mimeTypes: new Set([
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp",
    ]),
  },
};

const EXTENSIONS = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

function fileStorageConfig() {
  const database = databaseConfig();
  const bucket =
    String(process.env.SUPABASE_STORAGE_BUCKET || "").trim() ||
    DEFAULT_BUCKET;

  return {
    url: database.url,
    serviceRoleKey: database.serviceRoleKey,
    bucket,
    configured: Boolean(
      database.url &&
        database.serviceRoleKey &&
        bucket,
    ),
  };
}

function safeSegment(value, fallback = "file") {
  const result = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

  return result || fallback;
}

function encodedObjectPath(path) {
  return String(path)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function parseDataUrl(dataUrl, kind) {
  const rule = FILE_RULES[kind];
  if (!rule) {
    const error = new Error("Unsupported storage file kind");
    error.code = "INVALID_FILE_KIND";
    throw error;
  }

  const match = String(dataUrl || "").match(
    /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/,
  );

  if (!match) {
    const error = new Error("Invalid file payload");
    error.code = "INVALID_FILE";
    throw error;
  }

  const mimeType = match[1].toLowerCase();
  if (!rule.mimeTypes.has(mimeType)) {
    const error = new Error("Unsupported file type");
    error.code = "INVALID_FILE_TYPE";
    throw error;
  }

  const buffer = Buffer.from(
    match[2].replace(/[\r\n]/g, ""),
    "base64",
  );

  if (!buffer.length || buffer.length > rule.maxBytes) {
    const error = new Error("File is too large");
    error.code = "FILE_TOO_LARGE";
    throw error;
  }

  validateMagicBytes(buffer, mimeType);

  return {
    buffer,
    mimeType,
    extension: EXTENSIONS[mimeType],
    size: buffer.length,
  };
}

function validateMagicBytes(buffer, mimeType) {
  let valid = false;

  if (mimeType === "application/pdf") {
    valid = buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  } else if (mimeType === "image/png") {
    valid =
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer.subarray(1, 4).toString("ascii") === "PNG";
  } else if (mimeType === "image/jpeg") {
    valid =
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff;
  } else if (mimeType === "image/webp") {
    valid =
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }

  if (!valid) {
    const error = new Error("File signature does not match its type");
    error.code = "INVALID_FILE_SIGNATURE";
    throw error;
  }
}

function makeObjectPath({
  organizationId,
  kind,
  identifier = "",
  extension,
}) {
  const org = safeSegment(organizationId, "organization");
  const id = safeSegment(identifier, crypto.randomUUID());
  const unique = crypto.randomUUID();
  const ext = safeSegment(extension, "bin");

  if (kind === "certificate") {
    return (
      "organizations/" +
      org +
      "/certificates/" +
      id +
      "/" +
      unique +
      "." +
      ext
    );
  }

  if (kind === "logo") {
    return (
      "organizations/" +
      org +
      "/branding/" +
      unique +
      "." +
      ext
    );
  }

  return (
    "organizations/" +
    org +
    "/templates/" +
    id +
    "-" +
    unique +
    "." +
    ext
  );
}

async function storageRequest(path, options = {}) {
  const config = fileStorageConfig();
  if (!config.configured) {
    const error = new Error("Supabase Storage is not configured");
    error.code = "FILE_STORAGE_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch(config.url + "/storage/v1/" + path, {
    ...options,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: "Bearer " + config.serviceRoleKey,
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text || null;
  }

  if (!response.ok) {
    const error = new Error(
      payload?.message ||
        payload?.error ||
        "Supabase Storage request failed",
    );
    error.status = response.status;
    error.code = "FILE_STORAGE_REQUEST_FAILED";
    throw error;
  }

  return payload;
}

async function uploadDataUrl({
  organizationId,
  kind,
  identifier,
  dataUrl,
}) {
  const config = fileStorageConfig();
  const file = parseDataUrl(dataUrl, kind);
  const objectPath = makeObjectPath({
    organizationId,
    kind,
    identifier,
    extension: file.extension,
  });

  await storageRequest(
    "object/" +
      encodeURIComponent(config.bucket) +
      "/" +
      encodedObjectPath(objectPath),
    {
      method: "POST",
      headers: {
        "Content-Type": file.mimeType,
        "x-upsert": "false",
        "Cache-Control": "3600",
      },
      body: file.buffer,
    },
  );

  return {
    path: objectPath,
    mimeType: file.mimeType,
    size: file.size,
  };
}

async function removeObject(objectPath) {
  if (!objectPath) return false;

  const config = fileStorageConfig();

  await storageRequest(
    "object/" + encodeURIComponent(config.bucket),
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prefixes: [objectPath],
      }),
    },
  );

  return true;
}

function normalizeSignedUrl(value) {
  const config = fileStorageConfig();
  const signed = String(value || "");

  if (/^https?:\/\//i.test(signed)) return signed;
  if (signed.startsWith("/")) return config.url + signed;

  return config.url + "/storage/v1/" + signed.replace(/^\/+/, "");
}

async function createSignedUrl(objectPath, expiresIn = 600) {
  if (!objectPath) return null;

  const config = fileStorageConfig();
  const payload = await storageRequest(
    "object/sign/" +
      encodeURIComponent(config.bucket) +
      "/" +
      encodedObjectPath(objectPath),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        expiresIn: Math.min(Math.max(Number(expiresIn) || 600, 60), 3600),
      }),
    },
  );

  const value =
    payload?.signedURL ||
    payload?.signedUrl ||
    payload?.signed_url ||
    null;

  return value ? normalizeSignedUrl(value) : null;
}

module.exports = {
  FILE_RULES,
  fileStorageConfig,
  parseDataUrl,
  uploadDataUrl,
  removeObject,
  createSignedUrl,
};
