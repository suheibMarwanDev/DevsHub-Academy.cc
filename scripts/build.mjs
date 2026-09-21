import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/assets", { recursive: true });
await mkdir("dist/.openai", { recursive: true });

await cp("index.html", "dist/index.html");
await cp("assets", "dist/assets", { recursive: true });
await cp(".openai/hosting.json", "dist/.openai/hosting.json");

console.log("Built static deployment into dist/");
