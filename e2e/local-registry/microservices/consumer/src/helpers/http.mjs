import assert from 'node:assert/strict';

const defaultTimeoutMs = 10_000;
const retryDelayMs = 100;

export async function waitForJson(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() <= deadline) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        assert.match(
          response.headers.get('content-type') ?? '',
          /^application\/json\b/u,
        );

        return await response.json();
      }

      lastError = new Error(`GET ${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(retryDelayMs);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`GET ${url} did not return JSON within ${timeoutMs}ms`);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
