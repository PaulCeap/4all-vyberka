import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export async function fetchManual({ directory = "data/manual" } = {}) {
  let files = [];
  try {
    files = (await readdir(directory)).filter((file) => file.endsWith(".json"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const rows = [];
  for (const file of files) {
    const content = JSON.parse(await readFile(path.join(directory, file), "utf8"));
    rows.push(...(Array.isArray(content) ? content : [content]));
  }
  return rows.map((row) => ({ ...row, source: row.source || "manual" }));
}
