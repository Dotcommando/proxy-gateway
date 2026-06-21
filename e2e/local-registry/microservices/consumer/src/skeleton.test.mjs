import assert from 'node:assert/strict';
import test from 'node:test';

test('microservice e2e test runner is wired', () => {
  assert.match(process.versions.node, /^\d+\.\d+\.\d+$/u);
});
