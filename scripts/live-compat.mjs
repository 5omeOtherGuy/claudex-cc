// Protected live compatibility run. Requires CODEX_AUTH_JSON (a gateway
// credential file's content) in the environment; writes it owner-only into a
// temporary XDG root, installs the pinned gateway, boots a session gateway,
// and runs the smoke suite plus a synthetic compaction-scale token count.
// Output is statuses only, passed through central redaction; the credential
// file is deleted in all exit paths. Live inference (stream/tool checks) runs
// only when LIVE_COMPAT_INFERENCE=true.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const { GATEWAY_MANIFEST } = await import(
  new URL("../dist/src/gateway/manifest.js", import.meta.url)
);
const { installGatewayVersion } = await import(
  new URL("../dist/src/gateway/install.js", import.meta.url)
);
const { runGatewaySmoke } = await import(new URL("../dist/src/gateway/smoke.js", import.meta.url));
const { startSessionGateway } = await import(
  new URL("../dist/src/lifecycle/session.js", import.meta.url)
);
const { createCliproxyLauncher, defaultHealthProbe } = await import(
  new URL("../dist/src/lifecycle/cliproxy.js", import.meta.url)
);
const { DEFAULT_CONFIG } = await import(new URL("../dist/src/config/defaults.js", import.meta.url));
const { redactSecrets } = await import(
  new URL("../dist/src/security/redaction.js", import.meta.url)
);

const say = (line) => process.stdout.write(`${redactSecrets(line)}\n`);

const credential = process.env.CODEX_AUTH_JSON;
if (credential === undefined || credential.trim() === "") {
  process.stderr.write(
    "CODEX_AUTH_JSON is not set. Configure it as a secret of the protected environment; it must contain one gateway credential file's JSON.\n",
  );
  process.exit(1);
}

const root = await mkdtemp(join(tmpdir(), "claudex-live-"));
const stateDir = join(root, "state");
const credentialsDir = join(stateDir, "credentials");
const paths = {
  configDir: join(root, "config"),
  configFile: join(root, "config", "config.json"),
  configBackupFile: join(root, "config", "config.json.bak"),
  dataDir: join(root, "data"),
  stateDir,
  credentialsDir,
};

let session;
let failed = false;
try {
  await mkdir(credentialsDir, { recursive: true, mode: 0o700 });
  await writeFile(join(credentialsDir, "codex-live.json"), credential, { mode: 0o600 });

  say(`installing pinned gateway ${GATEWAY_MANIFEST.version}`);
  const installed = await installGatewayVersion({
    paths,
    manifest: GATEWAY_MANIFEST,
    platform: process.platform,
    arch: process.arch,
  });
  if (!installed.ok) {
    say(`install: fail (${installed.error})`);
    process.exit(1);
  }
  say("install: pass (checksum verified)");

  session = await startSessionGateway({
    paths,
    config: DEFAULT_CONFIG,
    binaryFile: installed.binaryFile,
    launcher: createCliproxyLauncher(),
    probe: defaultHealthProbe,
    port: 0,
  });
  if (!session.ok) {
    say(`gateway-start: fail (${session.error})`);
    process.exit(1);
  }
  say("gateway-start: pass");

  const smoke = await runGatewaySmoke({
    target: session.session,
    models: DEFAULT_CONFIG.models,
    allowLiveInference: process.env.LIVE_COMPAT_INFERENCE === "true",
  });
  for (const check of smoke.checks) {
    say(`${check.name}: ${check.status}${check.status === "fail" ? ` (${check.detail})` : ""}`);
  }
  failed = !smoke.ok;

  // Compaction-scale token counting: a synthetic long conversation near the
  // compaction threshold must still count without errors. Unbilled.
  const filler = "claudex compaction probe. ".repeat(2_000);
  const messages = Array.from({ length: 24 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: [{ type: "text", text: filler }],
  }));
  try {
    const response = await fetch(
      `http://${session.session.host}:${session.session.port}/v1/messages/count_tokens`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.session.clientSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: DEFAULT_CONFIG.models.main, messages }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    say(`compaction-count: ${response.ok ? "pass" : `fail (HTTP ${response.status})`}`);
    failed = failed || !response.ok;
  } catch (error) {
    say(`compaction-count: fail (${error instanceof Error ? error.message : "error"})`);
    failed = true;
  }
} finally {
  await session?.session?.stop?.().catch(() => {});
  await rm(root, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
