import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, requestJson } from "../src/lib/api/http-client.ts";

test("sends same-origin requests and parses JSON responses", async () => {
  const originalFetch = globalThis.fetch;
  let requestOptions;
  globalThis.fetch = async (_input, options) => {
    requestOptions = options;
    return new Response(JSON.stringify({ session: null }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    assert.deepEqual(await requestJson("/api/auth/session"), { session: null });
    assert.equal(requestOptions.credentials, "same-origin");
    assert.equal(requestOptions.headers.get("Accept"), "application/json");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("surfaces API errors without converting them into success-shaped data", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code: "unauthenticated", message: "Sign in required." } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });

  try {
    await assert.rejects(requestJson("/api/auth/session"), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "unauthenticated");
      assert.equal(error.message, "Sign in required.");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reports a network failure explicitly", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("offline");
  };

  try {
    await assert.rejects(requestJson("/api/auth/session"), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 0);
      assert.equal(error.code, "network_error");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
