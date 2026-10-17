// Gate secret scan: fails on credential-shaped strings in tracked and
// not-ignored files of the current Git checkout. It reports file, line, and
// rule only, never the matched text. Tests that need credential-shaped values
// must build them from parts at runtime.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RULES = [
  ["private key", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ["GitHub token", /\b(?:gh[opusr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ["OpenAI or Anthropic key", /\bsk-(?:proj-|ant-[a-z0-9]+-)?[A-Za-z0-9_-]{20,}/],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/],
  ["Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ["npm token", /\bnpm_[A-Za-z0-9]{36}\b/],
  ["JSON Web Token", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
];

// Fixed diagnostics only: Git's stderr and Node error messages can echo file
// content or configuration values, so they are never forwarded.
function fail(message) {
  process.stderr.write(`secret-scan: ${message}\n`);
  process.exit(2);
}

let listing;
try {
  listing = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch {
  fail("could not list the checkout's files with git; run it inside a Git work tree.");
}
const files = listing.split("\0").filter((file) => file.length > 0);

const findings = [];
for (const file of files) {
  let content;
  try {
    content = readFileSync(file);
  } catch (error) {
    const code = error?.code;
    if (code === "ENOENT" || code === "EISDIR") {
      continue; // deleted in the work tree, a dangling symlink, or a submodule
    }
    fail(`could not read ${file} (${typeof code === "string" ? code : "unknown error"}).`);
  }
  if (content.includes(0)) {
    continue; // binary
  }
  const lines = content.toString("utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const [name, pattern] of RULES) {
      if (pattern.test(line)) {
        findings.push(`${file}:${index + 1}: ${name}`);
      }
    }
  });
}

if (findings.length > 0) {
  process.stderr.write(
    `secret-scan: ${findings.length} credential-shaped string(s) found:\n${findings.join("\n")}\n` +
      "Remove them; tests must build credential-shaped values from parts.\n",
  );
  process.exit(1);
}
