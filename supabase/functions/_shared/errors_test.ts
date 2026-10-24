import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import { AppError, errorResponse, MESSAGE_BY_CODE } from "./errors.ts";

Deno.test("an error answers { error } and nothing else when it has no details", async () => {
  const response = errorResponse(new AppError("INTERNAL", "db:save_ready:XX000"), "req-1");
  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    error: { code: "INTERNAL", message: MESSAGE_BY_CODE.INTERNAL, requestId: "req-1" },
  });
});

Deno.test("the 402 carries the saved entry and the week's usage beside error, and its reason stays out of the body", async () => {
  const usage = { used: 3, limit: 3, resetsAt: "2026-10-26T00:00:00.000Z" };
  const error = new AppError("LIMIT_REACHED", "free_limit", { entryId: "entry-1", usage });
  const response = errorResponse(error, "req-2", { "x-test": "1" });
  assertEquals(response.status, 402);
  assertEquals(response.headers.get("x-test"), "1");
  const body = await response.json();
  assertEquals(Object.keys(body).sort(), ["entryId", "error", "usage"]);
  assertEquals(body.error, { code: "LIMIT_REACHED", message: MESSAGE_BY_CODE.LIMIT_REACHED, requestId: "req-2" });
  assertEquals(body.entryId, "entry-1");
  assertEquals(body.usage, usage);
  // The reason is for the log line and nothing else.
  assert(!JSON.stringify(body).includes("free_limit"));
  assertEquals(error.reason, "free_limit");
});

Deno.test("an error built the old way still has no details, and a reason of its own", () => {
  const error = new AppError("TOO_SHORT");
  assertEquals([error.details, error.reason, error.status], [null, "too_short", 422]);
});
