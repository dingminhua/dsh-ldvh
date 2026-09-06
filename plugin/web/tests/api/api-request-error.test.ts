import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiRequestError, fetchObjects } from '../../src/utils/api.ts';

test('WorkCase list transport failure preserves the safe error reason and code', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    ok: false,
    error: 'Fact service unavailable',
    stderr: 'private diagnostic must not become the message',
    exitCode: 'fact_service_unavailable',
  }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });
  try {
    await assert.rejects(fetchObjects('workcase'), (error: unknown) => {
      assert.ok(error instanceof ApiRequestError);
      assert.equal(error.status, 503);
      assert.equal(error.code, 'fact_service_unavailable');
      assert.equal(error.message, 'Fact service unavailable');
      assert.doesNotMatch(error.message, /private diagnostic/);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
