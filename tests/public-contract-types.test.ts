import { describe, expect, it } from '@jest/globals';

import {
  type NodeHttpHandler,
  RESPONSE_CODE,
  TARGET_ACCESS_REJECTION_REASON,
  TARGET_ACCESS_RESULT_KIND,
  type TargetFinalUrlCheckInput,
  type TargetFinalUrlCheckResult,
  type TargetFinalUrlGuardPort,
} from '../src';

describe('public contract types', () => {
  it('exports Node HTTP handler and final URL guard public types', () => {
    const handler: NodeHttpHandler = async (_request, response) => {
      response.statusCode = 204;
      response.end();
    };
    const checkInput: TargetFinalUrlCheckInput = {
      baseUrl: 'https://example.com/start',
      url: 'https://example.com/final',
    };
    const allowedGuard: TargetFinalUrlGuardPort = {
      check: () => ({
        kind: TARGET_ACCESS_RESULT_KIND.ALLOWED,
      }),
    };
    const rejectedResult: TargetFinalUrlCheckResult = {
      code: RESPONSE_CODE.TARGET_ACCESS_DENIED,
      kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
      message: 'Denied.',
      reason: TARGET_ACCESS_REJECTION_REASON.PRIVATE_IP_RANGE,
      status: 403,
    };

    expect(typeof handler).toBe('function');
    expect(allowedGuard.check(checkInput)).toEqual({
      kind: TARGET_ACCESS_RESULT_KIND.ALLOWED,
    });
    expect(rejectedResult).toEqual({
      code: RESPONSE_CODE.TARGET_ACCESS_DENIED,
      kind: TARGET_ACCESS_RESULT_KIND.REJECTED,
      message: 'Denied.',
      reason: TARGET_ACCESS_REJECTION_REASON.PRIVATE_IP_RANGE,
      status: 403,
    });
  });
});
