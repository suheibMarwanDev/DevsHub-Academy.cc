import { readFile } from "node:fs/promises";

const index = await readFile("index.html", "utf8");
const dist = await readFile("dist/index.html", "utf8");
const css = await readFile("assets/styles.css", "utf8");
const js = await readFile("assets/app.js", "utf8");

const failures = [];

if (index !== dist) failures.push("root and dist index.html differ");
if (!index.includes('href="assets/styles.css"')) failures.push("stylesheet link missing");
if (!index.includes('src="assets/app.js"')) failures.push("application script link missing");
if (!css.includes("PREMIUM CREDENTIAL UX")) failures.push("premium verifier styles missing");
if (!js.includes("hydrateRemoteCerts")) failures.push("certificate sync logic missing");

if (failures.length) {
  console.error("Project check failed:");
  failures.forEach((failure) => console.error("- " + failure));
  process.exit(1);
}

console.log("Project structure check passed.");
