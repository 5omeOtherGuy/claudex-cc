// Emits the GitHub release notes for the current version: the matching
// changelog section plus the fixed support/boundary statement. Never includes
// anything beyond those two public documents.
import { readFile } from "node:fs/promises";
import process from "node:process";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const { GATEWAY_MANIFEST } = await import(
  new URL("../dist/src/gateway/manifest.js", import.meta.url)
);

const changelog = await readFile(new URL("CHANGELOG.md", root), "utf8");
const marker = `## [${packageJson.version}]`;
const start = changelog.indexOf(marker);
if (start === -1) {
  process.stderr.write(`CHANGELOG.md has no "${marker}" section.\n`);
  process.exit(1);
}
const rest = changelog.slice(start + marker.length);
const nextSection = rest.search(/\n## \[/);
const body = (nextSection === -1 ? rest : rest.slice(0, nextSection))
  .replace(/^[^\n]*\n/, "")
  .trim();

process.stdout.write(`${body}

## Supported platforms and versions

- Linux (x64/arm64): persistent (systemd user service) and session modes
- macOS (Intel/Apple Silicon): persistent (LaunchAgent) and session modes
- Windows (x64/arm64): session mode
- Pinned gateway: CLIProxyAPI ${GATEWAY_MANIFEST.version} (checksum-verified before execution)
- Compatibility baseline: see docs/compatibility-matrix.md

## Boundary

Claudex is an unofficial compatibility product. Anthropic documents gateways
for Claude models and does not support routing Claude Code to non-Claude
models; running Claudex is your own decision and subject to the providers'
terms. A running Claude Code session never switches providers — only new
sessions started through the \`claudex\` launcher use the gateway.
`);
