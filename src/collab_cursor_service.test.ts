import test from "node:test";
import assert from "node:assert/strict";
import { canEnterDocument } from "./collab_cursor_service.ts";

test("only a verified session with returned data enters the editor document", () => {
  assert.equal(canEnterDocument({ ok: true, data: { user_id: "creator-7" } }), true);
  assert.equal(canEnterDocument({ ok: true }), false);
  assert.equal(canEnterDocument({ ok: false, data: { user_id: "creator-7" } }), false);
});
