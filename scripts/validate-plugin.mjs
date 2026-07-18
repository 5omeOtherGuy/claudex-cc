import { access, readdir, readFile, stat } from "node:fs/promises";
import process from "node:process";

const root = new URL("../", import.meta.url);
const requiredSkills = ["setup", "login", "config", "doctor", "status", "update", "uninstall"];

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), "utf8"));
}

const [manifest, packageJson] = await Promise.all([
  readJson(".claude-plugin/plugin.json"),
  readJson("package.json"),
]);

const failures = [];
if (manifest.name !== "claudex") failures.push("plugin name must be claudex");
if (manifest.version !== packageJson.version) failures.push("plugin and package versions differ");
if (manifest.license !== "MIT") failures.push("plugin license must be MIT");

for (const skill of requiredSkills) {
  const path = new URL(`skills/${skill}/SKILL.md`, root);
  try {
    await access(path);
  } catch {
    failures.push(`missing skill: ${skill}`);
  }
}

for (const relativePath of ["bin/claudex-pluginctl", "hooks/hooks.json", "agents/diagnostics.md"]) {
  try {
    await access(new URL(relativePath, root));
  } catch {
    failures.push(`missing plugin component: ${relativePath}`);
  }
}

const entries = await readdir(new URL("skills/", root));
for (const entry of entries) {
  const info = await stat(new URL(`skills/${entry}`, root));
  if (!info.isDirectory()) failures.push(`unexpected non-directory in skills/: ${entry}`);
}

if (failures.length > 0) {
  process.stderr.write(`${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`plugin validation passed (${requiredSkills.length} skills)\n`);
}
