"use strict";

const { databaseConfig } = require("./database");

const ACCESS_COOKIE = "devshub_access";
const REFRESH_COOKIE = "devshub_refresh";
const ORG_COOKIE = "devshub_org";

function isDemoMode() {
  return String(process.env.DEMO_MODE || "true").toLowerCase() !== "false";
}

function authConfig() {
  const database = databaseConfig();
  const anonKey = String(process.env.SUPABASE_ANON_KEY || "");

  return {
    url: database.url,
    serviceRoleKey: database.serviceRoleKey,
    anonKey,
    configured: Boolean(database.url && database.serviceRoleKey && anonKey),
  };
}

function parseCookies(header = "") {
  return String(header)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, pair) => {
      const index = pair.indexOf("=");
      if (index < 0) return cookies;
      const key = pair.slice(0, index).trim();
      const value = pair.slice(index + 1);
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
      return cookies;
    }, {});
}

function cookie(name, value, options = {}) {
  const parts = [
    name + "=" + encodeURIComponent(value || ""),
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];

  const secure =
    process.env.VERCEL === "1" ||
    process.env.NODE_ENV === "production";

  if (secure) parts.push("Secure");
  if (Number.isFinite(options.maxAge)) {
    parts.push("Max-Age=" + Math.max(0, Math.floor(options.maxAge)));
  }

  return parts.join("; ");
}

function appendSetCookie(res, values) {
  const current = res.getHeader("Set-Cookie");
  const merged = [
    ...(Array.isArray(current) ? current : current ? [current] : []),
    ...values,
  ];
  res.setHeader("Set-Cookie", merged);
}

function setSessionCookies(res, session) {
  const accessMaxAge = Math.max(60, Number(session.expires_in || 3600));
  appendSetCookie(res, [
    cookie(ACCESS_COOKIE, session.access_token, { maxAge: accessMaxAge }),
    cookie(REFRESH_COOKIE, session.refresh_token, {
      maxAge: 60 * 60 * 24 * 30,
    }),
  ]);
}

function clearSessionCookies(res) {
  appendSetCookie(res, [
    cookie(ACCESS_COOKIE, "", { maxAge: 0 }),
    cookie(REFRESH_COOKIE, "", { maxAge: 0 }),
  ]);
}

async function authRequest(path, {
  method = "GET",
  token = null,
  body = null,
  useServiceRole = false,
} = {}) {
  const config = authConfig();
  if (!config.configured) {
    const error = new Error("Authentication is not configured");
    error.code = "AUTH_NOT_CONFIGURED";
    throw error;
  }

  const apiKey = useServiceRole ? config.serviceRoleKey : config.anonKey;
  const response = await fetch(config.url + path, {
    method,
    headers: {
      apikey: apiKey,
      Authorization: "Bearer " + (token || apiKey),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
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
      payload?.msg ||
        payload?.message ||
        payload?.error_description ||
        "Authentication request failed",
    );
    error.status = response.status;
    error.code = payload?.error_code || "AUTH_REQUEST_FAILED";
    throw error;
  }

  return payload;
}

async function signInWithPassword(email, password) {
  return authRequest("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
}

async function refreshAuthSession(refreshToken) {
  return authRequest("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: { refresh_token: refreshToken },
  });
}

async function getAuthUser(accessToken) {
  return authRequest("/auth/v1/user", {
    token: accessToken,
  });
}

async function serviceRest(path) {
  const config = authConfig();
  if (!config.configured) {
    const error = new Error("Authentication is not configured");
    error.code = "AUTH_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch(config.url + "/rest/v1/" + path, {
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: "Bearer " + config.serviceRoleKey,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = new Error("Membership lookup failed");
    error.status = response.status;
    error.code = "MEMBERSHIP_LOOKUP_FAILED";
    throw error;
  }

  return response.json();
}

async function getMemberships(userId) {
  const rows = await serviceRest(
    "organization_members?select=id,organization_id,role,organizations(id,name,display_name,slug,verification_slug,custom_domain,status,logo_path,primary_color,secondary_color)&user_id=eq." +
      encodeURIComponent(userId),
  );

  if (!Array.isArray(rows)) return [];

  return rows
    .map((member) => {
      const organization = member.organizations || null;
      if (!organization || organization.status !== "active") return null;
      return {
        id: member.id,
        role: member.role,
        organization,
      };
    })
    .filter(Boolean);
}

async function getMembership(userId) {
  const memberships = await getMemberships(userId);
  return memberships[0] || null;
}

function setActiveOrganizationCookie(res, slug) {
  appendSetCookie(res, [
    cookie(ORG_COOKIE, slug || "", {
      maxAge: 60 * 60 * 24 * 30,
    }),
  ]);
}

function clearActiveOrganizationCookie(res) {
  appendSetCookie(res, [
    cookie(ORG_COOKIE, "", { maxAge: 0 }),
  ]);
}

async function resolveSession(req, res) {
  if (isDemoMode()) {
    return {
      authenticated: true,
      demoMode: true,
      user: null,
      membership: {
        role: "demo",
        organization: {
          name: "DevsHub Academy",
          display_name: "DevsHub Academy",
          slug: "devshub-academy",
          verification_slug: "devshub-academy",
        },
      },
      memberships: [
        {
          role: "demo",
          organization: {
            name: "DevsHub Academy",
            display_name: "DevsHub Academy",
            slug: "devshub-academy",
            verification_slug: "devshub-academy",
          },
        },
      ],
    };
  }

  const config = authConfig();
  if (!config.configured) {
    return {
      authenticated: false,
      demoMode: false,
      configurationRequired: true,
    };
  }

  const cookies = parseCookies(req.headers.cookie || "");
  let accessToken = cookies[ACCESS_COOKIE] || "";
  const refreshToken = cookies[REFRESH_COOKIE] || "";

  let user = null;

  if (accessToken) {
    try {
      user = await getAuthUser(accessToken);
    } catch {}
  }

  if (!user && refreshToken) {
    try {
      const refreshed = await refreshAuthSession(refreshToken);
      accessToken = refreshed.access_token;
      setSessionCookies(res, refreshed);
      user = refreshed.user || (await getAuthUser(accessToken));
    } catch {
      clearSessionCookies(res);
    }
  }

  if (!user) {
    return {
      authenticated: false,
      demoMode: false,
    };
  }

  const memberships = await getMemberships(user.id);
  if (!memberships.length) {
    clearSessionCookies(res);
    return {
      authenticated: false,
      demoMode: false,
      membershipRequired: true,
    };
  }

  const requestedSlug = String(cookies[ORG_COOKIE] || "").trim();
  const membership =
    memberships.find(
      (item) => item.organization?.slug === requestedSlug,
    ) || memberships[0];

  if (membership?.organization?.slug !== requestedSlug) {
    setActiveOrganizationCookie(
      res,
      membership?.organization?.slug || "",
    );
  }

  return {
    authenticated: true,
    demoMode: false,
    user: {
      id: user.id,
      email: user.email || null,
    },
    membership,
    memberships,
  };
}

async function requireAdminAccess(req, res, {
  write = false,
} = {}) {
  const session = await resolveSession(req, res);

  if (!session.authenticated) {
    return {
      allowed: false,
      session,
      status: session.configurationRequired ? 503 : 401,
    };
  }

  if (session.demoMode) {
    return {
      allowed: true,
      session,
    };
  }

  const role = session.membership?.role;
  const allowedRoles = write
    ? ["owner", "admin", "issuer"]
    : ["owner", "admin", "issuer", "viewer"];

  return {
    allowed: allowedRoles.includes(role),
    session,
    status: 403,
  };
}

module.exports = {
  authConfig,
  isDemoMode,
  signInWithPassword,
  getMembership,
  getMemberships,
  resolveSession,
  requireAdminAccess,
  setSessionCookies,
  clearSessionCookies,
  setActiveOrganizationCookie,
  clearActiveOrganizationCookie,
};
