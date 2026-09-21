"use strict";

const {
  storageConfig,
  listCertificates,
  getCertificate,
  createCertificate,
  updateCertificate,
} = require("./lib/storage");
const {
  BASE_CERTIFICATES,
  VALID_STATUSES,
  generateSerial,
  normalizePrefix,
  normalizeCertificate,
  normalizeCertificatePatch,
  parseRequestBody,
  isDemoMode,
} = require("./lib/certificates");
const { requireAdminAccess } = require("./lib/auth");
const { databaseConfig, logAudit, logVerification } = require("./lib/database");

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.end(JSON.stringify(body));
}

function organizationIdFrom(access) {
  return access?.session?.membership?.organization?.id || null;
}

function actorIdFrom(access) {
  return access?.session?.user?.id || null;
}

async function generateUniqueSerial(prefix) {
  const safePrefix = normalizePrefix(prefix);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const serial = generateSerial(safePrefix);

    if (!storageConfig().configured) {
      const demoCollision = BASE_CERTIFICATES.some(
        (item) => item.serial === serial,
      );
      if (!demoCollision) return serial;
      continue;
    }

    const existing = await getCertificate(serial);
    if (!existing) return serial;
  }

  const error = new Error("Unable to allocate unique certificate serial");
  error.code = "SERIAL_GENERATION_FAILED";
  throw error;
}

async function auditCertificate(access, action, certificate, details = {}) {
  if (!databaseConfig().configured || !certificate) return;

  await logAudit({
    organizationId: organizationIdFrom(access),
    actorUserId: actorIdFrom(access),
    action,
    entityType: "certificate",
    entityId: certificate.id || null,
    details: {
      serial: certificate.serial,
      ...details,
    },
  }).catch(() => {});
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const serial = String(req.query?.serial || "").trim().toUpperCase();

      if (serial) {
        const certificate = storageConfig().configured
          ? await getCertificate(serial)
          : null;
        const fallback =
          BASE_CERTIFICATES.find((item) => item.serial === serial) || null;
        const result = certificate || fallback;

        if (databaseConfig().configured) {
          await logVerification({
            certificateId: result?.id || null,
            serial,
            result: result?.status || "not_found",
            source: ["serial", "qr", "direct_link"].includes(
              String(req.query?.source || "serial").toLowerCase(),
            )
              ? String(req.query?.source || "serial").toLowerCase()
              : "serial",
            userAgent: String(req.headers["user-agent"] || "").slice(0, 500),
          }).catch(() => {});
        }

        return json(res, result ? 200 : 404, {
          certificate: result,
          storage: storageConfig().provider,
        });
      }

      const access = await requireAdminAccess(req, res, { write: false });
      if (!access.allowed) {
        return json(res, access.status || 401, {
          error: "Admin authentication required",
          authenticated: false,
        });
      }

      const q = String(req.query?.q || "").trim().slice(0, 120);
      const status = String(req.query?.status || "").trim().toLowerCase();
      const limit = Math.min(Math.max(Number(req.query?.limit) || 100, 1), 500);

      if (status && !VALID_STATUSES.has(status)) {
        return json(res, 400, { error: "Invalid certificate status" });
      }

      let certificates;

      if (storageConfig().configured) {
        certificates = await listCertificates({
          organizationId: organizationIdFrom(access),
          q,
          status,
          limit,
        });
      } else {
        const search = q.toLowerCase();
        certificates = BASE_CERTIFICATES.filter((certificate) => {
          if (
            status &&
            String(certificate.status || "valid").toLowerCase() !== status
          ) {
            return false;
          }

          if (!search) return true;

          return [certificate.serial, certificate.name, certificate.course]
            .join(" ")
            .toLowerCase()
            .includes(search);
        }).slice(0, limit);
      }

      return json(res, 200, {
        certificates,
        count: certificates.length,
        filters: { q, status: status || null, limit },
        storage: storageConfig().provider,
        demoMode: isDemoMode(),
        session: {
          demoMode: access.session.demoMode,
          user: access.session.user || null,
          membership: access.session.membership || null,
        },
      });
    }

    if (req.method === "POST") {
      const access = await requireAdminAccess(req, res, { write: true });
      if (!access.allowed) {
        return json(res, access.status || 401, {
          error:
            access.status === 403
              ? "This account does not have permission to issue certificates"
              : "Admin authentication required",
          authenticated: Boolean(access.session?.authenticated),
        });
      }

      const body = parseRequestBody(req.body) || {};
      const normalized = normalizeCertificate(body, { requireSerial: false });

      if (!normalized) {
        return json(res, 400, { error: "Invalid certificate payload" });
      }

      const serial = await generateUniqueSerial(body.prefix);
      const certificate = {
        ...normalized,
        serial,
        status: normalized.status || "valid",
      };

      if (!storageConfig().configured) {
        if (!isDemoMode()) {
          return json(res, 503, { error: "Cloud storage is not configured" });
        }

        return json(res, 201, {
          certificate,
          storage: "demo",
          persisted: false,
        });
      }

      const created = await createCertificate(certificate, {
        organizationId: organizationIdFrom(access),
      });

      await auditCertificate(access, "certificate.issued", created, {
        status: created.status,
      });

      return json(res, 201, {
        certificate: created,
        storage: storageConfig().provider,
        persisted: true,
      });
    }

    if (req.method === "PATCH") {
      const access = await requireAdminAccess(req, res, { write: true });
      if (!access.allowed) {
        return json(res, access.status || 401, {
          error:
            access.status === 403
              ? "This account does not have permission to update certificates"
              : "Admin authentication required",
        });
      }

      const body = parseRequestBody(req.body) || {};
      const serial = String(
        req.query?.serial || body.serial || "",
      ).trim().toUpperCase();

      if (!serial) {
        return json(res, 400, { error: "Certificate serial is required" });
      }

      const patch = normalizeCertificatePatch(body);
      if (!patch) {
        return json(res, 400, { error: "No valid certificate updates supplied" });
      }

      if (!storageConfig().configured) {
        if (!isDemoMode()) {
          return json(res, 503, { error: "Cloud storage is not configured" });
        }

        return json(res, 200, {
          certificate: { serial, ...patch },
          storage: "demo",
          persisted: false,
        });
      }

      const current = await getCertificate(serial, {
        organizationId: organizationIdFrom(access),
      });

      if (!current) {
        return json(res, 404, { error: "Certificate not found" });
      }

      const updated = await updateCertificate(serial, patch, {
        organizationId: organizationIdFrom(access),
      });

      if (!updated) {
        return json(res, 404, { error: "Certificate not found" });
      }

      const action =
        patch.status === "revoked"
          ? "certificate.revoked"
          : patch.status === "valid" && current.status === "revoked"
            ? "certificate.restored"
            : "certificate.updated";

      await auditCertificate(access, action, updated, {
        previousStatus: current.status,
        newStatus: updated.status,
        changedFields: Object.keys(patch),
      });

      return json(res, 200, {
        certificate: updated,
        storage: storageConfig().provider,
        persisted: true,
      });
    }

    res.setHeader("Allow", "GET, POST, PATCH");
    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    if (error?.code === "STORAGE_NOT_CONFIGURED") {
      return json(res, 503, { error: "Cloud storage is not configured" });
    }

    if (
      error?.code === "DATABASE_CONFLICT" ||
      error?.code === "STORAGE_CONFLICT"
    ) {
      return json(res, 409, {
        error: "Certificate serial already exists",
      });
    }

    console.error("certificate_api_error", error);
    return json(res, 500, { error: "Certificate request failed" });
  }
};
