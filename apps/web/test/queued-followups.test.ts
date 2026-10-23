import assert from "node:assert/strict";
import test from "node:test";
import { acknowledgeQueuedFollowup, appendQueuedFollowup, attachmentReferences, maxQueuedFollowups, normalizeQueuedFollowups, queueMatchesConversation, removeQueuedFollowup, type QueuedFollowup } from "../src/queued-followups";
const queued = (id: string, predecessorRunId: string): QueuedFollowup => ({ id, predecessorRunId, rootRunId: "root", projectId: "project", prompt: `Follow-up ${id}`, attachments: [] });

test("a persisted follow-up only dispatches after its own conversation, project, and predecessor", () => {
  const item = queued("client1", "run1");
  assert.equal(queueMatchesConversation(item, "root", "run1", "project"), true);
  assert.equal(queueMatchesConversation(item, "other", "run1", "project"), false);
  assert.equal(queueMatchesConversation(item, "root", "run2", "project"), false);
  assert.equal(queueMatchesConversation(item, "root", "run1", undefined), false);
  assert.equal(queueMatchesConversation({ ...item, error: "Offline" }, "root", "run1", "project"), false);
});

test("standalone follow-ups wait until server project ownership has been resolved", () => {
  const { projectId: _projectId, ...standalone } = queued("standalone", "run1");
  assert.equal(queueMatchesConversation(standalone, "root", "run1", undefined), false);
  assert.equal(queueMatchesConversation(standalone, "root", "run1", null), true);
  assert.equal(queueMatchesConversation(standalone, "root", "run1", "project"), false);
});

test("the queue rejects overflow without losing an existing message", () => {
  const items = Array.from({ length: maxQueuedFollowups }, (_, index) => queued(`client${index}`, `run${index}`));
  const overflow = appendQueuedFollowup(items, queued("overflow", "last"));
  assert.equal(overflow.accepted, false);
  assert.equal(overflow.items, items);
  assert.equal(overflow.items.length, 32);
  const available = appendQueuedFollowup(items.slice(0, -1), queued("new", "last"));
  assert.equal(available.accepted, true);
  assert.equal(available.items.at(-1)?.id, "new");
});

test("structured attachment references survive queue persistence without leaking paths into the request", () => {
  const item = { ...queued("upload", "run1"), attachments: [{ id: "legacy-id", fileId: "registered-file", name: "evidence.txt", path: "/private/workspace/evidence.txt", mimeType: "text/plain", size: 15, sizeBytes: 16 }] };
  const restored = normalizeQueuedFollowups(JSON.parse(JSON.stringify([item])));
  assert.deepEqual(attachmentReferences(restored[0]!.attachments), [{ fileId: "registered-file", name: "evidence.txt", mimeType: "text/plain", sizeBytes: 16 }]);
  assert.deepEqual(attachmentReferences([{ id: "legacy-id", name: "old.txt", path: "/private/old.txt", mimeType: "text/plain", size: 15 }]), [{ fileId: "legacy-id", name: "old.txt", mimeType: "text/plain", sizeBytes: 15 }]);
});

test("acknowledgement removes an accepted follow-up and advances only its linked successor", () => {
  const items = [queued("client1", "run1"), queued("client2", "client1"), { ...queued("other", "runX"), rootRunId: "other-root" }];
  const acknowledged = acknowledgeQueuedFollowup(items, "client1", "run2");
  assert.deepEqual(acknowledged.map((item) => [item.id, item.predecessorRunId]), [["client2", "run2"], ["other", "runX"]]);
  assert.equal(items.length, 3);
});

test("removing a queued message preserves the successor chain", () => {
  const items = [queued("client1", "run1"), queued("client2", "client1"), queued("client3", "client2")];
  assert.deepEqual(removeQueuedFollowup(items, "client2").map((item) => [item.id, item.predecessorRunId]), [["client1", "run1"], ["client3", "client1"]]);
});

test("restores only validated queue records, attachments and stable unique request ids", () => {
  const valid = { ...queued("client1", "run1"), attachments: [{ id: "file", name: "evidence.txt", path: "/local/evidence.txt", mimeType: "text/plain", size: 15 }] };
  assert.deepEqual(normalizeQueuedFollowups([valid, valid, { prompt: "missing ownership" }, null]), [valid]);
  assert.deepEqual(normalizeQueuedFollowups("not an array"), []);
});
