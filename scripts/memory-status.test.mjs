import assert from "node:assert/strict";
import test from "node:test";
import { getMemoryServiceStatus } from "../dist/server/services/memoryStatus.js";

const configuredEnv = {
  MEMORY_SERVICE_URL: "https://memory.example.test/base/",
  MEMORY_SERVICE_API_KEY: "super-secret-service-key"
};

function response(body, ok = true) {
  return { ok, json: async () => body };
}

test("missing configuration is reported without making a request", async () => {
  let called = false;
  const status = await getMemoryServiceStatus({}, async () => {
    called = true;
    throw new Error("unexpected request");
  });
  assert.equal(called, false);
  assert.deepEqual(
    { configured: status.configured, status: status.status, database: status.database, vectorStore: status.vectorStore },
    { configured: false, status: "unconfigured", database: "unknown", vectorStore: "unknown" }
  );
});

test("healthy dependencies are normalized and the key stays in the request header", async () => {
  let requestUrl = "";
  let authorization = "";
  const status = await getMemoryServiceStatus(configuredEnv, async (url, init) => {
    requestUrl = String(url);
    authorization = new Headers(init?.headers).get("authorization") || "";
    return response({ status: "ok", database: "ok", pgvector: "ok" });
  });
  assert.equal(requestUrl, "https://memory.example.test/base/healthz");
  assert.equal(authorization, `Bearer ${configuredEnv.MEMORY_SERVICE_API_KEY}`);
  assert.equal(status.status, "healthy");
  assert.equal(JSON.stringify(status).includes(configuredEnv.MEMORY_SERVICE_API_KEY), false);
});

test("a valid unhealthy response is degraded even when upstream returns 503", async () => {
  const status = await getMemoryServiceStatus(configuredEnv, async () =>
    response({ status: "unhealthy", database: "unavailable", pgvector: "unavailable" }, false)
  );
  assert.equal(status.status, "degraded");
  assert.equal(status.database, "unavailable");
  assert.equal(status.vectorStore, "unavailable");
});

test("connection failures and malformed responses are offline", async () => {
  const failed = await getMemoryServiceStatus(configuredEnv, async () => {
    throw new Error("connection refused");
  });
  const malformed = await getMemoryServiceStatus(configuredEnv, async () => response({ status: "ok" }));
  assert.equal(failed.status, "offline");
  assert.equal(malformed.status, "offline");
  assert.equal(failed.database, "unknown");
});

test("unsafe URL credentials and query details are never returned", async () => {
  const status = await getMemoryServiceStatus(
    {
      MEMORY_SERVICE_URL: "https://user:password@memory.example.test/base?token=hidden",
      MEMORY_SERVICE_API_KEY: "service-key"
    },
    async () => response({ status: "ok", database: "ok", pgvector: "ok" })
  );
  assert.equal(status.serviceUrl, "https://memory.example.test/base");
});
