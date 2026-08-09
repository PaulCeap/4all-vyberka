import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { validateDataset } from "../src/model.mjs";

const required = ["public/index.html", "public/styles.css", "public/app.js", "public/CNAME", "public/data/tenders.json"];
for (const file of required) {
  const content = await readFile(file, "utf8");
  if (!content.trim()) throw new Error(`${file} je prázdný.`);
}
validateDataset(JSON.parse(await readFile("public/data/tenders.json", "utf8")));
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
console.log("Web je připravený v dist/.");
