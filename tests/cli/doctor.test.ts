import assert from "node:assert/strict";
import test from "node:test";
import { createOfflineDoctorReport } from "../../src/commands/doctor.js";

void test("offline doctor exposes metadata without credentials", () => {
  const report = createOfflineDoctorReport();

  assert.equal(report.status, "scaffold");
  assert.equal(report.gatewayVersion, "7.2.86");
  assert.match(report.gatewayTarget, /^http:\/\/127\.0\.0\.1:/);
  assert.doesNotMatch(JSON.stringify(report), /token|authorization|bearer|api.?key/i);
});
