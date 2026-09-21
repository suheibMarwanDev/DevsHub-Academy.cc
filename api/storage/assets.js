"use strict";

const { requireAdminAccess } = require("../../server/auth");
const {
  databaseConfig,
  getDefaultOrganizationId,
  getOrganizationById,
  updateOrganizationSettings,
  listCertificateTemplates,
  setActiveCertificateTemplate,
  deleteCertificateTemplate,
  logAudit,
} = require("../../server/database");
const {
  fileStorageConfig,
  removeObject,
} = require("../../server/file-storage");
const {
  requestOriginAllowed,
  applyApiSecurityHeaders,
} = require("../../server/security");

function json(res, status, body) {
  applyApiSecurityHeaders(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(JSON.stringify(body));
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "object") return body;
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

async function organizationIdFrom(access) {
  return (
    access?.session?.membership?.organization?.id ||
    (await getDefaultOrganizationId())
  );
}

module.exports = async function handler(req, res) {
  try {
    const write = req.method !== "GET";
    if (write && !requestOriginAllowed(req)) {
      return json(res, 403, { error: "Invalid request origin" });
    }
    const access = await requireAdminAccess(req, res, { write });

    if (!access.allowed) {
      return json(res, access.status || 401, {
        error: write
          ? "This account does not have asset management permission"
          : "Admin authentication required",
      });
    }

    if (!databaseConfig().configured || !fileStorageConfig().configured) {
      return json(res, 503, {
        error: "Supabase database/storage is not configured",
        storageConfigured: false,
      });
    }

    const organizationId = await organizationIdFrom(access);

    if (req.method === "GET") {
      const [organization, templates] = await Promise.all([
        getOrganizationById(organizationId),
        listCertificateTemplates(organizationId),
      ]);

      return json(res, 200, {
        organization: organization
          ? {
              id: organization.id,
              name: organization.name,
              displayName:
                organization.display_name || organization.name,
              slug: organization.slug,
              customDomain: organization.custom_domain || null,
              primaryColor:
                organization.primary_color || "#0B7783",
              secondaryColor:
                organization.secondary_color || "#0B2B34",
              hasLogo: Boolean(organization.logo_path),
              logoUrl: organization.logo_path
                ? "/api/storage/logo?slug=" +
                  encodeURIComponent(organization.slug)
                : null,
            }
          : null,
        templates: templates.map((template) => ({
          id: template.id,
          name: template.name,
          fileType: template.file_type,
          isActive: template.is_active,
          createdAt: template.created_at,
          fileUrl:
            "/api/storage/template?id=" +
            encodeURIComponent(template.id),
        })),
      });
    }

    const body = parseBody(req.body);

    if (req.method === "PATCH") {
      if (body.organization && typeof body.organization === "object") {
        const role = access.session?.membership?.role;
        if (!access.session?.demoMode && !["owner", "admin"].includes(role)) {
          return json(res, 403, {
            error: "Only organization owners and admins can edit branding",
          });
        }

        const settings = body.organization;
        const colorPattern = /^#[0-9A-F]{6}$/i;

        if (
          settings.primaryColor &&
          !colorPattern.test(String(settings.primaryColor))
        ) {
          return json(res, 400, { error: "Invalid primary color" });
        }

        if (
          settings.secondaryColor &&
          !colorPattern.test(String(settings.secondaryColor))
        ) {
          return json(res, 400, { error: "Invalid secondary color" });
        }

        const updated = await updateOrganizationSettings(
          organizationId,
          settings,
        );

        await logAudit({
          organizationId,
          actorUserId: access.session?.user?.id || null,
          action: "organization.branding_updated",
          entityType: "organization",
          entityId: organizationId,
          details: {
            changedFields: Object.keys(settings),
          },
        }).catch(() => {});

        return json(res, 200, { organization: updated });
      }

      const templateId = String(body.templateId || "").trim();
      if (!templateId) {
        return json(res, 400, { error: "Template id is required" });
      }

      const template = await setActiveCertificateTemplate(
        organizationId,
        templateId,
      );

      if (!template) {
        return json(res, 404, { error: "Template not found" });
      }

      await logAudit({
        organizationId,
        actorUserId: access.session?.user?.id || null,
        action: "template.activated",
        entityType: "template",
        entityId: template.id,
        details: { name: template.name },
      }).catch(() => {});

      return json(res, 200, { template });
    }

    if (req.method === "DELETE") {
      const templateId = String(
        req.query?.id || body.templateId || "",
      ).trim();

      if (!templateId) {
        return json(res, 400, { error: "Template id is required" });
      }

      const template = await deleteCertificateTemplate(
        organizationId,
        templateId,
      );

      if (!template) {
        return json(res, 404, { error: "Template not found" });
      }

      if (template.file_path) {
        await removeObject(template.file_path).catch(() => {});
      }
      if (template.preview_path) {
        await removeObject(template.preview_path).catch(() => {});
      }

      await logAudit({
        organizationId,
        actorUserId: access.session?.user?.id || null,
        action: "template.deleted",
        entityType: "template",
        entityId: template.id,
        details: { path: template.file_path },
      }).catch(() => {});

      return json(res, 200, { deleted: true, id: templateId });
    }

    res.setHeader("Allow", "GET, PATCH, DELETE");
    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error("storage_assets_error", error);
    return json(res, 500, { error: "Asset request failed" });
  }
};
