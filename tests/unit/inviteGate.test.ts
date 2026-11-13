import { test } from "node:test";
import assert from "node:assert/strict";
import { enterInviteCode, hasEnteredInviteCode, inviteGateApplies, isInviteCode, INVITE_GATE_KEY } from "../../src/lib/inviteGate.ts";
import { INVITE_CODES } from "../../src/config/inviteCodes.ts";

// The early-access invite gate (lib/inviteGate.ts): a soft gate in front of the website's app.

const store = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const CODES = ["GROW-2026", "Spring Group"];

test("a code matches without regard to capitals, spaces or dashes; anything else does not", () => {
  for (const ok of ["GROW-2026", "grow-2026", " grow 2026 ", "GROW2026", "spring-group", "ＧＲＯＷ２０２６"]) assert.equal(isInviteCode(ok, CODES), true, ok);
  for (const no of ["", "   ", "-", "GROW-2025", "GROW", "GROW-2026x"]) assert.equal(isInviteCode(no, CODES), false, no);
});

test("a correct code is remembered on the device; a wrong one leaves nothing behind", () => {
  const s = store();
  assert.equal(hasEnteredInviteCode(s), false);
  assert.equal(enterInviteCode("nope", s, CODES), false);
  assert.equal(s.m.size, 0);
  assert.equal(enterInviteCode("grow 2026", s, CODES), true);
  assert.equal(s.m.get(INVITE_GATE_KEY), "entered");
  assert.equal(hasEnteredInviteCode(s), true);
});

test("retiring a code stops new entries with it but keeps in those who already entered", () => {
  const s = store();
  assert.equal(enterInviteCode("Spring Group", s, CODES), true);
  const retired = ["GROW-2026"];
  assert.equal(isInviteCode("Spring Group", retired), false);
  assert.equal(hasEnteredInviteCode(s), true);
});

test("a browser that refuses storage still lets a correct code in for this visit", () => {
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(enterInviteCode("GROW-2026", broken, CODES), true);
  assert.equal(hasEnteredInviteCode(broken), false);
  assert.equal(hasEnteredInviteCode(null), false);
});

test("the gate stands only in front of the website's production build", () => {
  const web = { production: true, ios: false, openingInvitation: false };
  assert.equal(inviteGateApplies(web), true);
  assert.equal(inviteGateApplies({ ...web, production: false }), false, "dev server and browser tests");
  assert.equal(inviteGateApplies({ ...web, ios: true }), false, "the iOS app");
  assert.equal(inviteGateApplies({ ...web, openingInvitation: true }), false, "an invitation to a shared child profile");
  assert.equal(inviteGateApplies({ ...web, setting: "off" }), false);
  assert.equal(inviteGateApplies({ ...web, production: false, setting: "on" }), true);
  assert.equal(inviteGateApplies({ ...web, ios: true, setting: "on" }), false);
});

test("the config file has at least one usable code, and no two that are the same code", () => {
  assert.ok(INVITE_CODES.length > 0);
  for (const code of INVITE_CODES) assert.equal(isInviteCode(code), true, code);
  const seen = new Set(INVITE_CODES.map(c => c.toUpperCase().replace(/[\s\-_]+/g, "")));
  assert.equal(seen.size, INVITE_CODES.length);
});
