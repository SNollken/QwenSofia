import { test } from "node:test";
import assert from "node:assert/strict";
import { dashboardHtml } from "../dashboard/page.ts";

test("dashboard Métricas renders an in-panel health view", () => {
  assert.match(
    dashboardHtml,
    /<button type="button" id="metricsBtn">Métricas<\/button>/,
    "Métricas must be an in-panel navigation control",
  );
  assert.doesNotMatch(
    dashboardHtml,
    /onclick="location\.href='\/metrics'"/,
    "Métricas must not navigate to the protected Prometheus text endpoint",
  );
  assert.match(
    dashboardHtml,
    /id="metricsView"/,
    "dashboard must provide a rendered metrics view",
  );
  assert.match(
    dashboardHtml,
    /api\(["']\/health["']/,
    "metrics view must load the public health snapshot",
  );
});
