/**
 * Live smoke test: verifies the public name is still free.
 * Soft-skips when there is no network (offline CI, sandbox without egress).
 */
import test from "node:test";
import assert from "node:assert/strict";

function networkUp() {
  return fetch("https://registry.npmjs.org/modeldrift", {
    method: "GET",
    signal: AbortSignal.timeout(8000),
  })
    .then((r) => r)
    .catch(() => null);
}

test("live: npm name modeldrift is still unclaimed (404)", async (t) => {
  const res = await networkUp();
  if (res === null) {
    t.skip("no network: cannot reach the npm registry");
    return;
  }
  assert.equal(res.status, 404, "npm name modeldrift should still be free (404)");
});

test("live: GitHub repo techdevfun/modeldrift does not exist yet (404)", async (t) => {
  let res = null;
  try {
    res = await fetch("https://api.github.com/repos/techdevfun/modeldrift", {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/vnd.github+json" },
    });
  } catch {
    res = null;
  }
  if (res === null) {
    t.skip("no network: cannot reach api.github.com");
    return;
  }
  assert.equal(res.status, 404, "techdevfun/modeldrift should not exist yet (404)");
});
