import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");
const publicExtensions = new Set([
  ".html", ".css", ".js", ".svg", ".jpg", ".jpeg", ".png", ".ico",
  ".webp", ".woff2", ".txt", ".xml",
]);
const publicDirectories = new Set(["candidates", "lawmakers", "fonts"]);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isFile() && publicExtensions.has(path.extname(entry.name).toLowerCase())) {
    await cp(path.join(root, entry.name), path.join(output, entry.name));
  } else if (entry.isDirectory() && publicDirectories.has(entry.name)) {
    await cp(path.join(root, entry.name), path.join(output, entry.name), { recursive: true });
  }
}
