"use strict";

const {
  resolveSession,
  getMemberships,
  setActiveOrganizationCookie,
} = require("../../server/auth");
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

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const session = await resolveSession(req, res);
      return json(res, 200, session);
    }

    if (req.method === "POST") {
      if (!requestOriginAllowed(req)) {
        return json(res, 403, { error: "Invalid request origin" });
      }

      const session = await resolveSession(req, res);

      if (!session.authenticated || session.demoMode) {
        return json(res, session.demoMode ? 200 : 401, session);
      }

      const body = parseBody(req.body);
      const slug = String(body.organizationSlug || "").trim();

      if (!slug) {
        return json(res, 400, {
          error: "Organization slug is required",
        });
      }

      const memberships = await getMemberships(session.user.id);
      const membership = memberships.find(
        (item) => item.organization?.slug === slug,
      );

      if (!membership) {
        return json(res, 403, {
          error: "You do not have access to this organization",
        });
      }

      setActiveOrganizationCookie(res, slug);

      return json(res, 200, {
        authenticated: true,
        demoMode: false,
        user: session.user,
        membership,
        memberships,
      });
    }

    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    return json(res, 200, {
      authenticated: false,
      demoMode: false,
      error: "Unable to resolve session",
    });
  }
};
