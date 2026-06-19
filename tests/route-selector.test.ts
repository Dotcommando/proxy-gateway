import { describe, expect, it } from '@jest/globals';

import {
  RESPONSE_CODE,
  ROUTE_SELECTION_RESULT_KIND,
  STRING_MATCHER_KIND,
} from '../src/constants';
import type { ProxyRouteConfig } from '../src/domain/routing';
import { selectRoute } from '../src/domain/routing';

interface TestPlan {
  provider: string;
}

const route = (
  config: Omit<ProxyRouteConfig<TestPlan>, 'plan'> & {
    provider?: string;
  },
): ProxyRouteConfig<TestPlan> => ({
  ...config,
  plan: {
    provider: config.provider ?? config.id,
  },
});

describe('selectRoute', () => {
  it('uses higher priority before declaration order', () => {
    const result = selectRoute({
      routes: [
        route({
          id: 'first-low',
          match: {
            host: 'api.example.com',
          },
          priority: 1,
        }),
        route({
          id: 'second-high',
          match: {
            host: 'api.example.com',
          },
          priority: 10,
        }),
      ],
      target: {
        method: 'GET',
        url: 'https://api.example.com/v1/models',
      },
    });

    expect(result.kind).toBe(ROUTE_SELECTION_RESULT_KIND.MATCHED);

    if (result.kind === ROUTE_SELECTION_RESULT_KIND.MATCHED) {
      expect(result.route.id).toBe('second-high');
      expect(result.route.plan.provider).toBe('second-high');
    }
  });

  it('keeps declaration order stable when priorities are equal', () => {
    const result = selectRoute({
      routes: [
        route({
          id: 'first',
          match: {
            path: {
              type: STRING_MATCHER_KIND.GLOB,
              value: '/v1/**',
            },
          },
          priority: 5,
        }),
        route({
          id: 'second',
          match: {
            path: {
              type: STRING_MATCHER_KIND.GLOB,
              value: '/v1/**',
            },
          },
          priority: 5,
        }),
      ],
      target: {
        method: 'GET',
        url: 'https://api.example.com/v1/models',
      },
    });

    expect(result.kind).toBe(ROUTE_SELECTION_RESULT_KIND.MATCHED);

    if (result.kind === ROUTE_SELECTION_RESULT_KIND.MATCHED) {
      expect(result.route.id).toBe('first');
    }
  });

  it('evaluates exclude only after a positive match', () => {
    const result = selectRoute({
      routes: [
        route({
          exclude: {
            path: {
              type: STRING_MATCHER_KIND.GLOB,
              value: '/admin/**',
            },
          },
          id: 'api-with-admin-excluded',
          match: {
            host: {
              type: STRING_MATCHER_KIND.SUFFIX,
              value: 'example.com',
            },
          },
          priority: 10,
        }),
        route({
          id: 'fallback-api',
          match: {
            host: {
              type: STRING_MATCHER_KIND.SUFFIX,
              value: 'example.com',
            },
          },
          priority: 1,
        }),
      ],
      target: {
        method: 'GET',
        url: 'https://api.example.com/admin/users',
      },
    });

    expect(result.kind).toBe(ROUTE_SELECTION_RESULT_KIND.MATCHED);

    if (result.kind === ROUTE_SELECTION_RESULT_KIND.MATCHED) {
      expect(result.route.id).toBe('fallback-api');
    }
  });

  it('selects the default route only after no configured route matched', () => {
    const result = selectRoute({
      defaultRoute: {
        id: 'default',
        plan: {
          provider: 'default-provider',
        },
      },
      routes: [
        route({
          id: 'vendor-api',
          match: {
            host: 'vendor.example.com',
          },
        }),
      ],
      target: {
        method: 'GET',
        url: 'https://unknown.example.com/v1/models',
      },
    });

    expect(result.kind).toBe(ROUTE_SELECTION_RESULT_KIND.DEFAULT);

    if (result.kind === ROUTE_SELECTION_RESULT_KIND.DEFAULT) {
      expect(result.route.id).toBe('default');
      expect(result.route.plan.provider).toBe('default-provider');
    }
  });

  it('returns a stable no-match result when no route and no default match', () => {
    const result = selectRoute({
      routes: [
        route({
          id: 'vendor-api',
          match: {
            host: 'vendor.example.com',
          },
        }),
      ],
      target: {
        method: 'GET',
        url: 'https://unknown.example.com/v1/models',
      },
    });

    expect(result).toEqual({
      code: RESPONSE_CODE.NO_ROUTE_MATCHED,
      kind: ROUTE_SELECTION_RESULT_KIND.NO_MATCH,
      message: 'No route matched the target request.',
    });
  });

  it('matches URL, host, path, and method conditions together', () => {
    const result = selectRoute({
      routes: [
        route({
          id: 'models-post',
          match: {
            host: {
              type: STRING_MATCHER_KIND.SUFFIX,
              value: 'example.com',
            },
            method: ['POST'],
            path: {
              type: STRING_MATCHER_KIND.GLOB,
              value: '/v*/models',
            },
            url: /^https:\/\/api\.example\.com\//,
          },
        }),
      ],
      target: {
        method: 'post',
        url: 'https://API.Example.COM./v1/models?limit=10',
      },
    });

    expect(result.kind).toBe(ROUTE_SELECTION_RESULT_KIND.MATCHED);

    if (result.kind === ROUTE_SELECTION_RESULT_KIND.MATCHED) {
      expect(result.route.id).toBe('models-post');
    }
  });

  it('uses package enums for route selection result kinds and no-match codes', () => {
    expect(ROUTE_SELECTION_RESULT_KIND.MATCHED).toBe('matched');
    expect(ROUTE_SELECTION_RESULT_KIND.DEFAULT).toBe('default');
    expect(ROUTE_SELECTION_RESULT_KIND.NO_MATCH).toBe('no-match');
    expect(RESPONSE_CODE.NO_ROUTE_MATCHED).toBe('NO_ROUTE_MATCHED');
  });
});
