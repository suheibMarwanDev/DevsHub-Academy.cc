"use strict";

const {
  authConfig,
  isDemoMode,
  signInWithPassword,
  getMemberships,
  setSessionCookies,
  setActiveOrganizationCookie,
  clearSessionCookies,
} = require("../../server/auth");

function json(res, status, body) {
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

  if (isDemoMode()) {
    return json(res, 200, {
      authenticated: true,
      demoMode: true,
    });
  }

  if (!authConfig().configured) {
    return json(res, 503, {
      error: "Authentication is not configured",
      configurationRequired: true,
    });
  }

  const body =
    typeof req.body === "object"
      ? req.body
      : (() => {
          try {
            return JSON.parse(req.body || "{}");
          } catch {
            return {};
          }
        })();

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!email || !password || password.length > 512) {
    return json(res, 400, {
      error: "Email and password are required",
    });
  }

  try {
    const session = await signInWithPassword(email, password);
    const memberships = await getMemberships(session.user?.id);
    const membership = memberships[0] || null;

    if (!membership) {
      clearSessionCookies(res);
      return json(res, 403, {
        error: "This account does not have access to an organization",
      });
    }

    setSessionCookies(res, session);
    setActiveOrganizationCookie(
      res,
      membership.organization?.slug || "",
    );

    return json(res, 200, {
      authenticated: true,
      demoMode: false,
      user: {
        id: session.user.id,
        email: session.user.email,
      },
      membership,
      memberships,
    });
  } catch (error) {
    clearSessionCookies(res);
    return json(res, error.status === 400 ? 401 : error.status || 401, {
      error: "Invalid email or password",
    });
  }
};
