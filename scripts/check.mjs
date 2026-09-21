import { readFile } from "node:fs/promises";

const index = await readFile("index.html", "utf8");
const dist = await readFile("dist/index.html", "utf8");
const css = await readFile("assets/styles.css", "utf8");
const js = await readFile("assets/app.js", "utf8");

const failures = [];

if (index !== dist) failures.push("root and dist index.html differ");
if (!index.includes('href="assets/styles.css"')) failures.push("stylesheet link missing");
if (!index.includes('src="assets/app.js"')) failures.push("application script link missing");
if (!index.includes("qrcode.min.js")) failures.push("QR generation library missing");
if (!index.includes("xlsx.full.min.js")) failures.push("CSV/Excel library missing");
if (!css.includes("PREMIUM CREDENTIAL UX")) failures.push("premium verifier styles missing");
if (!css.includes("PRODUCT COMPLETION UX")) failures.push("completed product styles missing");
if (!js.includes("hydrateRemoteCerts")) failures.push("certificate hydration logic missing");
if (!js.includes("issueBulkCertificates")) failures.push("bulk issuance logic missing");
if (!js.includes("renderOfficialQr")) failures.push("official QR logic missing");
if (!js.includes("loadDashboardMetrics")) failures.push("analytics logic missing");
if (!js.includes("orgSwitcher")) failures.push("multi-organization UI logic missing");

if (failures.length) {
  console.error("Project check failed:");
  failures.forEach((failure) => console.error("- " + failure));
  process.exit(1);
}

console.log("Project structure check passed.");
