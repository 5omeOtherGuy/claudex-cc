// Deterministic release verification: versions, changelog, compatibility
// metadata, and the package allowlist. Run after `npm run build`; fails
// closed on any mismatch. RELEASE_TAG (e.g. "v0.1.0") is required in the
// release workflow and optional locally.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url);

const failures = [];

const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const pluginJson = JSON.parse(await readFile(new URL(".claude-plugin/plugin.json", root), "utf8"));
const { VERSION } = await import(new URL("../dist/src/version.js", import.meta.url));
const { GATEWAY_MANIFEST } = await import(
  new URL("../dist/src/gateway/manifest.js", import.meta.url)
);

if (packageJson.version !== pluginJson.version) {
  failures.push(
    `package.json (${packageJson.version}) and plugin.json (${pluginJson.version}) versions differ`,
  );
}
if (packageJson.version !== VERSION) {
  failures.push(`package.json (${packageJson.version}) and src/version.ts (${VERSION}) differ`);
}

const releaseTag = process.env.RELEASE_TAG;
if (releaseTag !== undefined && releaseTag !== "") {
  if (releaseTag !== `v${packageJson.version}`) {
    failures.push(`tag ${releaseTag} does not match version v${packageJson.version}`);
  }
  const changelog = await readFile(new URL("CHANGELOG.md", root), "utf8");
  if (!changelog.includes(`## [${packageJson.version}]`)) {
    failures.push(
      `CHANGELOG.md has no "## [${packageJson.version}]" section; move the Unreleased entries before tagging`,
    );
  }
}

const matrix = await readFile(new URL("docs/compatibility-matrix.md", root), "utf8");
if (!matrix.includes(GATEWAY_MANIFEST.version)) {
  failures.push(
    `docs/compatibility-matrix.md does not document gateway ${GATEWAY_MANIFEST.version}`,
  );
}

// Package allowlist: everything npm would publish must sit under a reviewed
// prefix, and secret-shaped or internal files must never be packed.
const ALLOWED_PREFIXES = [
  ".claude-plugin/",
  "agents/",
  "bin/",
  "dist/",
  "docs/",
  "hooks/",
  "references/",
  "skills/",
];
const ALLOWED_FILES = new Set([
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
  "package.json",
]);
const FORBIDDEN_PATTERN =
  /(^|\/)(\.env|\.internal|node_modules|tests?|\.git)(\/|$)|\.(pem|key|p12)$/;

const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
  cwd: new URL(".", root).pathname,
  maxBuffer: 16 * 1024 * 1024,
});
const packed = JSON.parse(stdout)[0];
for (const entry of packed.files) {
  const path = entry.path;
  const allowed =
    ALLOWED_FILES.has(path) || ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
  if (!allowed) {
    failures.push(`packed file outside the allowlist: ${path}`);
  }
  if (FORBIDDEN_PATTERN.test(path)) {
    failures.push(`forbidden file would be packed: ${path}`);
  }
}

if (failures.length > 0) {
  process.stderr.write(
    `release verification failed:\n${failures.map((f) => `- ${f}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `release verification passed: v${packageJson.version}, gateway ${GATEWAY_MANIFEST.version}, ${packed.files.length} packed files\n`,
  );
}
