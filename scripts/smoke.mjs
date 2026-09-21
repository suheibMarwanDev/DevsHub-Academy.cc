const site = String(
  process.env.SITE_URL || "https://devs-hub-academy-cc.vercel.app",
).replace(/\/$/, "");

async function check(url, name) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "DevsHub-Academy-Smoke-Test/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(name + " returned HTTP " + response.status);
  }

  return response;
}

const home = await check(site + "/", "homepage");
const html = await home.text();

if (!html.includes("DevsHub Academy")) {
  throw new Error("homepage content check failed");
}

const health = await check(site + "/api/health", "health endpoint");
const payload = await health.json();

if (!payload.ok || payload.service !== "devshub-academy") {
  throw new Error("health payload check failed");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      site,
      health: payload,
    },
    null,
    2,
  ),
);
