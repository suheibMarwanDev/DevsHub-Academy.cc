"use strict";

const {
  clearSessionCookies,
  clearActiveOrganizationCookie,
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

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method not allowed" });
  }

  if (!requestOriginAllowed(req)) {
    return json(res, 403, { error: "Invalid request origin" });
  }

  clearSessionCookies(res);
  clearActiveOrganizationCookie(res);
  return json(res, 200, { authenticated: false });
};
