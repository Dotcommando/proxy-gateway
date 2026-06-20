import {
  GATEWAY_TIMEOUT_MESSAGE,
  PROXY_ATTEMPT_RESULT_OUTCOME,
  REQUEST_ABORTED_MESSAGE,
  RESPONSE_CODE,
  RETRY_CONDITION,
  TARGET_TIMEOUT_MESSAGE,
} from '../../constants';
import type {
  GatewayTargetRequest,
  GatewayTargetResponse,
  ProxyAttemptResult,
  ProxyRoute,
} from '../../ports/outbound';
import { RedactionService } from '../redaction';

const RETRY_CONDITION_BY_HTTP_STATUS = new Map<number, RETRY_CONDITION>([
  [403, RETRY_CONDITION.HTTP_403],
  [407, RETRY_CONDITION.HTTP_407],
  [408, RETRY_CONDITION.HTTP_408],
  [409, RETRY_CONDITION.HTTP_409],
  [425, RETRY_CONDITION.HTTP_425],
  [429, RETRY_CONDITION.HTTP_429],
  [500, RETRY_CONDITION.HTTP_500],
  [502, RETRY_CONDITION.HTTP_502],
  [503, RETRY_CONDITION.HTTP_503],
  [504, RETRY_CONDITION.HTTP_504],
]);

export interface ClassifiedServiceError {
  code: RESPONSE_CODE;
  message: string;
  retryable: boolean;
  status: number;
}

export interface ClassifiedAttempt {
  attemptResult: ProxyAttemptResult;
  diagnostics?: Record<string, unknown>;
  retryCondition?: RETRY_CONDITION;
  serviceError?: ClassifiedServiceError;
}

export interface ClassifyFailureInput {
  message?: string;
  outcome: PROXY_ATTEMPT_RESULT_OUTCOME;
  route?: ProxyRoute;
  target?: GatewayTargetRequest;
}

interface FailureMapping {
  code: RESPONSE_CODE;
  defaultMessage: string;
  retryable: boolean;
  retryCondition?: RETRY_CONDITION;
  status: number;
}

const FAILURE_MAPPINGS = new Map<PROXY_ATTEMPT_RESULT_OUTCOME, FailureMapping>([
  [
    PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_NETWORK_ERROR,
    {
      code: RESPONSE_CODE.TARGET_TRANSPORT_ERROR,
      defaultMessage: 'Target transport execution failed.',
      retryable: true,
      retryCondition: RETRY_CONDITION.TARGET_NETWORK_ERROR,
      status: 502,
    },
  ],
  [
    PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_TIMEOUT,
    {
      code: RESPONSE_CODE.TARGET_TIMEOUT,
      defaultMessage: TARGET_TIMEOUT_MESSAGE,
      retryable: true,
      retryCondition: RETRY_CONDITION.TARGET_TIMEOUT,
      status: 504,
    },
  ],
  [
    PROXY_ATTEMPT_RESULT_OUTCOME.PROXY_AUTH_ERROR,
    {
      code: RESPONSE_CODE.PROXY_AUTH_ERROR,
      defaultMessage: 'Proxy authentication failed.',
      retryable: false,
      retryCondition: RETRY_CONDITION.PROXY_AUTH_ERROR,
      status: 502,
    },
  ],
  [
    PROXY_ATTEMPT_RESULT_OUTCOME.PROXY_CONNECTION_ERROR,
    {
      code: RESPONSE_CODE.PROXY_CONNECTION_ERROR,
      defaultMessage: 'Proxy connection failed.',
      retryable: true,
      retryCondition: RETRY_CONDITION.PROXY_CONNECTION_ERROR,
      status: 502,
    },
  ],
  [
    PROXY_ATTEMPT_RESULT_OUTCOME.PROXY_TIMEOUT,
    {
      code: RESPONSE_CODE.PROXY_TIMEOUT,
      defaultMessage: 'Proxy request timed out.',
      retryable: true,
      retryCondition: RETRY_CONDITION.PROXY_TIMEOUT,
      status: 504,
    },
  ],
  [
    PROXY_ATTEMPT_RESULT_OUTCOME.GATEWAY_TIMEOUT,
    {
      code: RESPONSE_CODE.GATEWAY_TIMEOUT,
      defaultMessage: GATEWAY_TIMEOUT_MESSAGE,
      retryable: false,
      retryCondition: RETRY_CONDITION.GATEWAY_TIMEOUT,
      status: 504,
    },
  ],
  [
    PROXY_ATTEMPT_RESULT_OUTCOME.ABORTED,
    {
      code: RESPONSE_CODE.REQUEST_ABORTED,
      defaultMessage: REQUEST_ABORTED_MESSAGE,
      retryable: false,
      status: 499,
    },
  ],
  [
    PROXY_ATTEMPT_RESULT_OUTCOME.REJECTED_BY_POLICY,
    {
      code: RESPONSE_CODE.REJECTED_BY_POLICY,
      defaultMessage: 'Request was rejected by policy.',
      retryable: false,
      status: 403,
    },
  ],
  [
    PROXY_ATTEMPT_RESULT_OUTCOME.REQUEST_BODY_NOT_REPLAYABLE,
    {
      code: RESPONSE_CODE.REQUEST_BODY_NOT_REPLAYABLE,
      defaultMessage: 'Request body is not replayable.',
      retryable: false,
      status: 500,
    },
  ],
  [
    PROXY_ATTEMPT_RESULT_OUTCOME.RESPONSE_STREAM_ALREADY_STARTED,
    {
      code: RESPONSE_CODE.RESPONSE_STREAM_ALREADY_STARTED,
      defaultMessage: 'Response stream already started.',
      retryable: false,
      status: 500,
    },
  ],
  [
    PROXY_ATTEMPT_RESULT_OUTCOME.UNSUPPORTED_ROUTE,
    {
      code: RESPONSE_CODE.UNSUPPORTED_ROUTE,
      defaultMessage: 'Target transport does not support the selected route.',
      retryable: false,
      status: 502,
    },
  ],
  [
    PROXY_ATTEMPT_RESULT_OUTCOME.PROXY_GEO_MISMATCH,
    {
      code: RESPONSE_CODE.PROXY_GEO_MISMATCH,
      defaultMessage: 'Proxy exit did not match geo requirements.',
      retryable: true,
      retryCondition: RETRY_CONDITION.PROXY_GEO_MISMATCH,
      status: 502,
    },
  ],
  [
    PROXY_ATTEMPT_RESULT_OUTCOME.EXIT_VERIFICATION_FAILED,
    {
      code: RESPONSE_CODE.EXIT_VERIFICATION_FAILED,
      defaultMessage: 'Proxy exit verification failed.',
      retryable: true,
      retryCondition: RETRY_CONDITION.EXIT_VERIFICATION_FAILED,
      status: 502,
    },
  ],
]);

export class ResultClassifier {
  constructor(private readonly redactionService = new RedactionService()) {}

  classifyTargetResponse(response: GatewayTargetResponse): ClassifiedAttempt {
    const outcome =
      response.status >= 400
        ? PROXY_ATTEMPT_RESULT_OUTCOME.TARGET_HTTP_ERROR
        : PROXY_ATTEMPT_RESULT_OUTCOME.SUCCESS;
    const classified: ClassifiedAttempt = {
      attemptResult: {
        outcome,
        response,
      },
    };
    const retryCondition = RETRY_CONDITION_BY_HTTP_STATUS.get(response.status);

    if (retryCondition !== undefined) {
      classified.retryCondition = retryCondition;
    }

    return classified;
  }

  classifyFailure(input: ClassifyFailureInput): ClassifiedAttempt {
    const mapping = FAILURE_MAPPINGS.get(input.outcome);
    const message = input.message ?? mapping?.defaultMessage ?? 'Gateway attempt failed.';
    const code = mapping?.code ?? RESPONSE_CODE.TARGET_TRANSPORT_ERROR;
    const diagnostics = createDiagnostics(input, this.redactionService);
    const retryCondition = mapping?.retryCondition;
    const classified: ClassifiedAttempt = {
      attemptResult: {
        error: {
          code,
          message,
        },
        outcome: input.outcome,
      },
    };

    if (diagnostics !== undefined) {
      classified.diagnostics = diagnostics;
    }
    if (retryCondition !== undefined) {
      classified.retryCondition = retryCondition;
    }
    if (mapping !== undefined) {
      classified.serviceError = {
        code: mapping.code,
        message,
        retryable: mapping.retryable,
        status: mapping.status,
      };
    }

    return classified;
  }
}

function createDiagnostics(
  input: ClassifyFailureInput,
  redactionService: RedactionService,
): Record<string, unknown> | undefined {
  const route = input.route === undefined ? undefined : redactionService.redactRoute(input.route);
  const target = input.target === undefined ? undefined : createTargetDiagnostic(input.target, redactionService);

  if (route === undefined && target === undefined) {
    return undefined;
  }

  const diagnostics: Record<string, unknown> = {};

  if (route !== undefined) {
    diagnostics.route = route;
  }
  if (target !== undefined) {
    diagnostics.target = target;
  }

  return diagnostics;
}

function createTargetDiagnostic(
  target: GatewayTargetRequest,
  redactionService: RedactionService,
): Record<string, unknown> {
  return {
    headers: redactionService.redactHeaders(target.headers),
    method: target.method,
    url: redactionService.redactUrl(target.url),
  };
}
