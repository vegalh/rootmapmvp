import { test } from "node:test";
import assert from "node:assert/strict";
import { authFailure, authOptions, isValidCode, isValidEmail, normalizeCode, normalizeEmail } from "../../src/lib/cloud/auth.ts";

// The parts of sign-in that need no server. The full flow runs against the local stack in tests/db/auth.test.ts.

test("emails are trimmed and lower-cased; obvious non-addresses are refused", () => {
  assert.equal(normalizeEmail("  Parent@Example.COM "), "parent@example.com");
  for (const ok of ["a@b.co", " Parent@Example.com ", "名字@例子.中国"]) assert.ok(isValidEmail(ok), ok);
  for (const bad of ["", "parent", "parent@", "@example.com", "a b@example.com", "a@b", `${"a".repeat(250)}@b.co`]) assert.ok(!isValidEmail(bad), bad);
});

test("codes are exactly 6 digits; pasted spaces are ignored", () => {
  assert.equal(normalizeCode(" 123 456 "), "123456");
  for (const ok of ["123456", "123 456", "000000"]) assert.ok(isValidCode(ok), ok);
  for (const bad of ["", "12345", "1234567", "12a456", "１２３４５６"]) assert.ok(!isValidCode(bad), bad);
});

test("server errors become a small set of explainable failures", () => {
  assert.equal(authFailure({ name: "AuthRetryableFetchError", status: 0 }), "offline");
  assert.equal(authFailure(new TypeError("fetch failed")), "offline");
  assert.equal(authFailure({ status: 429, code: "over_email_send_rate_limit" }), "rate-limited");
  assert.equal(authFailure({ status: 400, code: "over_request_rate_limit" }), "rate-limited");
  assert.equal(authFailure({ status: 403, code: "otp_expired" }), "code-rejected");
  assert.equal(authFailure({ status: 401 }), "code-rejected");
  assert.equal(authFailure({ status: 422, code: "signup_disabled" }), "unavailable");
  assert.equal(authFailure({ status: 400, code: "email_address_invalid" }), "invalid-email");
  assert.equal(authFailure({ status: 500, code: "unexpected_failure" }), "unknown");
  assert.equal(authFailure(null), "unknown");
});

test("the session lives in the platform store, refreshes itself, and is never read from the URL", () => {
  const store = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
  const o = authOptions(store);
  assert.equal(o.storage, store);
  assert.equal(o.storageKey, "auth");
  assert.equal(o.persistSession, true);
  assert.equal(o.autoRefreshToken, true);
  assert.equal(o.detectSessionInUrl, false);
});

test("Welcome: new devices see it until the parent chooses; devices with RootMap data never do", async () => {
  const { welcomeDecision } = await import("../../src/lib/welcome.ts");
  const fresh = () => false, used = () => true;
  assert.equal(welcomeDecision("", fresh), "show");
  assert.equal(welcomeDecision("", used), "skip");
  // A reload in the middle of Welcome still shows it, even though the app has recorded its first run by then.
  assert.equal(welcomeDecision("pending", used), "show");
  assert.equal(welcomeDecision("done", fresh), "skip");
});
