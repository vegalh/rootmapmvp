import { test } from "node:test";
import assert from "node:assert/strict";
import { RELATIONSHIPS, accessOfRole, canAddAndEdit, canManage, childAccess, editableChildren, ownFamilyChildren, sameFamilyChildren } from "../../src/lib/childAccess.ts";
import { scopedId } from "../../src/lib/data/schema.ts";
import { copy } from "../../src/lib/i18n.ts";

// What a parent can do with each child, and how it is worded (Shared Child Profiles Phase 3;
// docs/shared-child-profiles-phase3.md). The server's roles decide; this is only what screens show.

const F = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const scopes = { shared: { [scopedId(F, "mia")]: "editor", [scopedId(F, "leo")]: "viewer", [scopedId(F, "ava")]: "owner" } };
const kids = [{ id: "emma" }, { id: scopedId(F, "mia") }, { id: scopedId(F, "leo") }, { id: scopedId(F, "ava") }];

test("technical roles map to plain access, unchanged underneath", () => {
  assert.equal(accessOfRole("owner"), "manage");
  assert.equal(accessOfRole("editor"), "edit");
  assert.equal(accessOfRole("viewer"), "view");
  assert.equal(accessOfRole(undefined), "view", "an unknown role allows nothing more than looking");
});

test("the user's own children (and every guest child) are theirs to manage; shared ones follow their role", () => {
  assert.equal(childAccess("emma", undefined), "manage");
  assert.equal(childAccess("emma", scopes), "manage");
  assert.equal(childAccess(scopedId(F, "mia"), scopes), "edit");
  assert.equal(childAccess(scopedId(F, "leo"), scopes), "view");
  assert.equal(childAccess(scopedId(F, "ava"), scopes), "manage");
  assert.equal(childAccess(scopedId(F, "gone"), scopes), "view", "a shared child sync doesn't know (yet) is view only");
  assert.ok(canAddAndEdit("edit") && canAddAndEdit("manage") && !canAddAndEdit("view"));
  assert.ok(canManage("manage") && !canManage("edit") && !canManage("view"));
});

test("pickers: editing offers only children the parent can add to; My Week only their own family; moves stay in a family", () => {
  assert.deepEqual(editableChildren(kids, scopes).map(k => k.id), ["emma", scopedId(F, "mia"), scopedId(F, "ava")]);
  assert.deepEqual(ownFamilyChildren(kids).map(k => k.id), ["emma"]);
  assert.deepEqual(sameFamilyChildren(kids, scopedId(F, "mia")).map(k => k.id), [scopedId(F, "mia"), scopedId(F, "leo"), scopedId(F, "ava")]);
  assert.deepEqual(sameFamilyChildren(kids, "emma").map(k => k.id), ["emma"]);
  // Guest space: everyone is the user's own.
  assert.deepEqual(editableChildren([{ id: "a" }, { id: "b" }], undefined).length, 2);
});

test("labels: English and Chinese, action words only, never the technical role", () => {
  const { en, zh } = copy;
  assert.deepEqual([en.accessManage, en.accessEdit, en.accessView], ["Manage Profile", "Add & Edit", "View Only"]);
  assert.deepEqual([zh.accessManage, zh.accessEdit, zh.accessView], ["管理档案", "一起记录", "看看成长"]);
  assert.equal(en.accessEditInfo, "Can add, edit, and organize the child’s shared growth records.");
  assert.equal(en.accessViewInfo, "Can view the child’s shared growth records but cannot make changes.");
  assert.equal(zh.accessEditInfo, "可以添加、编辑和整理孩子的成长记录。");
  assert.equal(zh.accessViewInfo, "可以查看孩子的成长记录，但不能修改。");
  assert.equal(en.circleTitle.replace("{name}", "Emma"), "Emma’s Circle");
  assert.equal(zh.circleTitle.replace("{name}", "Emma"), "陪伴Emma成长的人");
  assert.equal(en.inviteTitle.replace("{name}", "Emma"), "Invite someone to be part of Emma’s Circle");
  assert.equal(zh.inviteTitle.replace("{name}", "Emma"), "邀请更多人一起陪伴 Emma 成长");
  assert.equal(en.noAccessOne, "You no longer have access to this child’s profile.");
  assert.equal(zh.noAccessOne, "你已无法查看这份孩子档案。");
  const shown = (lang: typeof en | typeof zh) => Object.entries(lang).filter(([k]) => /^(access|circle|invite|rel_|noAccess|archived|viewOnly)/.test(k)).map(([, v]) => String(v));
  for (const text of [...shown(en), ...shown(zh)]) {
    assert.ok(!/\b(owner|editor|viewer|admin|collaborator|membership|revoked|authori[sz]ation|RLS)\b/i.test(text), `technical word in "${text}"`);
  }
});

test("relationship labels: the eight choices, in both languages", () => {
  assert.deepEqual([...RELATIONSHIPS], ["mom", "dad", "grandma", "grandpa", "teacher", "caregiver", "family", "other"]);
  assert.deepEqual(RELATIONSHIPS.map(r => copy.en[`rel_${r}`]), ["Mom", "Dad", "Grandma", "Grandpa", "Teacher", "Caregiver", "Family", "Other"]);
  assert.deepEqual(RELATIONSHIPS.map(r => copy.zh[`rel_${r}`]), ["妈妈", "爸爸", "奶奶", "爷爷", "老师", "照护者", "家人", "其他"]);
});
