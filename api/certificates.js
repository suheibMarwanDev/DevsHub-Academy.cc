const BASE_CERTIFICATES = [
  {
    serial: "DVH-2026-78421",
    name: "Ahmed Ali",
    course: "Web Development Essentials",
    date: "12 Sep 2026",
  },
];

const STORAGE_KEY = "devshub:certificates";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function storageConfig() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    "";
  return { url: url.replace(/\/$/, ""), token };
}

async function redisCommand(command) {
  const { url, token } = storageConfig();
  if (!url || !token) {
    const error = new Error("Cloud storage is not configured");
    error.code = "STORAGE_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch(url + "/pipeline", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([command]),
  });

  if (!response.ok) {
    throw new Error("Cloud storage request failed");
  }

  const data = await response.json();
  return data?.[0]?.result;
}

async function readCertificates() {
  const raw = await redisCommand(["GET", STORAGE_KEY]);
  if (!raw) return BASE_CERTIFICATES;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : BASE_CERTIFICATES;
  } catch {
    return BASE_CERTIFICATES;
  }
}

async function writeCertificates(certificates) {
  await redisCommand(["SET", STORAGE_KEY, JSON.stringify(certificates)]);
}

function normalizeCertificate(input) {
  if (!input || typeof input !== "object") return null;
  const serial = String(input.serial || "").trim().toUpperCase();
  const name = String(input.name || "").trim();
  const course = String(input.course || "").trim();
  const date = String(input.date || "").trim();

  if (!serial || !name || !course || !date) return null;
  if (!/^[A-Z0-9-]{6,40}$/.test(serial)) return null;

  return {
    serial,
    name: name.slice(0, 120),
    course: course.slice(0, 160),
    date: date.slice(0, 60),
    ...(input.pdf && /^https?:\/\//i.test(String(input.pdf))
      ? { pdf: String(input.pdf) }
      : {}),
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const certificates = await readCertificates();
      return json(res, 200, { certificates, storage: "cloud" });
    }

    if (req.method === "POST") {
      const cert = normalizeCertificate(req.body);
      if (!cert) {
        return json(res, 400, { error: "Invalid certificate payload" });
      }

      const certificates = await readCertificates();
      const index = certificates.findIndex(
        (item) => String(item.serial).toUpperCase() === cert.serial,
      );

      if (index >= 0) certificates[index] = { ...certificates[index], ...cert };
      else certificates.unshift(cert);

      await writeCertificates(certificates);
      return json(res, 200, { certificate: cert, storage: "cloud" });
    }

    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { error: "Method not allowed" });
  } catch (error) {
    if (error?.code === "STORAGE_NOT_CONFIGURED") {
      return json(res, 503, {
        error: "Cloud storage is not configured",
        requiredEnvironment: [
          "UPSTASH_REDIS_REST_URL",
          "UPSTASH_REDIS_REST_TOKEN",
        ],
      });
    }

    return json(res, 500, { error: "Storage request failed" });
  }
};
