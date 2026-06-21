import {
  PIPELINE_DECISION_KIND,
  PIPELINE_STEP_TYPE,
  PLANNER_RESULT_KIND,
  PROXY_PLAN_KIND,
  RESPONSE_CODE,
  RETRY_CONDITION,
} from '../../constants';
import type {
  ProxyGatewayServices,
  ProxyPipelineStep,
  ProxyPipelineStepResult,
  ProxyProviderCandidate,
  ProxyRouteRequirements,
} from '../../ports/outbound';
import {
  type ExecutionPlannerResult,
  mergeProxyRouteRequirements,
  type ProxyPlanAttemptConfig,
  type ProxyPlanConfig,
} from '../planning';
import {
  isParseFailure,
  parseRouteRequirements,
  parseVerificationRequirements,
  rejectInvalidArgs,
} from './built-in-requirement-steps';

interface IPlanServiceInput {
  candidates: ProxyProviderCandidate[];
  plan: ProxyPlanConfig;
}

interface IPlanService {
  plan(input: IPlanServiceInput): Promise<ExecutionPlannerResult>;
}

interface IParseSuccess<TValue> {
  ok: true;
  value: TValue;
}

interface IParseFailure {
  message: string;
  ok: false;
}

type ParseResult<TValue> = IParseFailure | IParseSuccess<TValue>;

export function createBuiltInPlanSteps(): ProxyPipelineStep[] {
  return [
    createStep(PIPELINE_STEP_TYPE.PLAN_FALLBACK, async (input) => {
      const planService = readPlanService(input.services);

      if (planService === undefined) {
        return rejectGatewayError('Pipeline plan service is not configured.');
      }

      const parsed = parseFallbackPlan(input.args, input.state.requirements, input.state.candidates);

      if (isParseFailure(parsed)) {
        return rejectInvalidArgs(parsed.message);
      }

      const plannerResult = await planService.plan({
        candidates: input.state.candidates,
        plan: parsed.value,
      });

      return plannerResult.kind === PLANNER_RESULT_KIND.REJECTED
        ? rejectPlannerResult(plannerResult)
        : {
            decision: {
              kind: PIPELINE_DECISION_KIND.USE_PLAN,
              plan: plannerResult.plan,
            },
          };
    }),
  ];
}

function createStep(type: PIPELINE_STEP_TYPE, execute: ProxyPipelineStep['execute']): ProxyPipelineStep {
  return {
    execute,
    type,
  };
}

function parseFallbackPlan(
  args: Record<string, unknown>,
  stateRequirements: ProxyRouteRequirements,
  candidates: ProxyProviderCandidate[],
): ParseResult<ProxyPlanConfig> {
  const attempts = parsePlanAttempts(args, stateRequirements, candidates);

  if (isParseFailure(attempts)) {
    return attempts;
  }

  const metadata = readOptionalRecord(args, 'metadata', PIPELINE_STEP_TYPE.PLAN_FALLBACK);

  if (isParseFailure(metadata)) {
    return metadata;
  }

  const stopOnTargetHttpError = readOptionalBoolean(
    args,
    'stopOnTargetHttpError',
    PIPELINE_STEP_TYPE.PLAN_FALLBACK,
  );

  if (isParseFailure(stopOnTargetHttpError)) {
    return stopOnTargetHttpError;
  }

  const totalTimeoutMs = readOptionalNumber(args, 'totalTimeoutMs', PIPELINE_STEP_TYPE.PLAN_FALLBACK);

  if (isParseFailure(totalTimeoutMs)) {
    return totalTimeoutMs;
  }

  return success({
    attempts: attempts.value,
    kind: PROXY_PLAN_KIND.FALLBACK,
    ...(metadata.value === undefined ? {} : { metadata: metadata.value }),
    ...(stopOnTargetHttpError.value === undefined ? {} : { stopOnTargetHttpError: stopOnTargetHttpError.value }),
    ...(totalTimeoutMs.value === undefined ? {} : { totalTimeoutMs: totalTimeoutMs.value }),
  });
}

function parsePlanAttempts(
  args: Record<string, unknown>,
  stateRequirements: ProxyRouteRequirements,
  candidates: ProxyProviderCandidate[],
): ParseResult<ProxyPlanAttemptConfig[]> {
  const rawAttempts = args.attempts;
  const candidateIds = candidates.map((candidate) => candidate.providerInstanceId);

  if (rawAttempts === undefined) {
    return success([
      {
        requirements: constrainRequirementsToCandidates(stateRequirements, candidateIds),
      },
    ]);
  }
  if (!Array.isArray(rawAttempts)) {
    return failure(`${PIPELINE_STEP_TYPE.PLAN_FALLBACK} args: attempts must be an array of objects.`);
  }

  const attempts: ProxyPlanAttemptConfig[] = [];

  for (const rawAttempt of rawAttempts) {
    if (!isRecord(rawAttempt)) {
      return failure(`${PIPELINE_STEP_TYPE.PLAN_FALLBACK} args: attempts must be an array of objects.`);
    }

    const parsed = parsePlanAttempt(rawAttempt, stateRequirements, candidateIds);

    if (isParseFailure(parsed)) {
      return parsed;
    }

    attempts.push(parsed.value);
  }

  return success(attempts);
}

function parsePlanAttempt(
  args: Record<string, unknown>,
  stateRequirements: ProxyRouteRequirements,
  candidateIds: string[],
): ParseResult<ProxyPlanAttemptConfig> {
  const provider = readOptionalString(args, 'provider', PIPELINE_STEP_TYPE.PLAN_FALLBACK);

  if (isParseFailure(provider)) {
    return provider;
  }

  const maxAttempts = readOptionalNumber(args, 'maxAttempts', PIPELINE_STEP_TYPE.PLAN_FALLBACK);

  if (isParseFailure(maxAttempts)) {
    return maxAttempts;
  }

  const metadata = readOptionalRecord(args, 'metadata', PIPELINE_STEP_TYPE.PLAN_FALLBACK);

  if (isParseFailure(metadata)) {
    return metadata;
  }

  const retryOn = readOptionalRetryConditions(args, 'retryOn', PIPELINE_STEP_TYPE.PLAN_FALLBACK);

  if (isParseFailure(retryOn)) {
    return retryOn;
  }

  const timeoutMs = readOptionalNumber(args, 'timeoutMs', PIPELINE_STEP_TYPE.PLAN_FALLBACK);

  if (isParseFailure(timeoutMs)) {
    return timeoutMs;
  }

  const requirements = parseAttemptRequirements(args, stateRequirements, candidateIds, provider.value);

  if (isParseFailure(requirements)) {
    return requirements;
  }

  return success({
    ...(provider.value === undefined ? {} : { provider: provider.value }),
    ...(maxAttempts.value === undefined ? {} : { maxAttempts: maxAttempts.value }),
    ...(metadata.value === undefined ? {} : { metadata: metadata.value }),
    ...(requirements.value === undefined ? {} : { requirements: requirements.value }),
    ...(retryOn.value === undefined ? {} : { retryOn: retryOn.value }),
    ...(timeoutMs.value === undefined ? {} : { timeoutMs: timeoutMs.value }),
  });
}

function parseAttemptRequirements(
  args: Record<string, unknown>,
  stateRequirements: ProxyRouteRequirements,
  candidateIds: string[],
  provider: string | undefined,
): ParseResult<ProxyRouteRequirements | undefined> {
  const rawRequirements = args.requirements;
  const verification = readOptionalRecord(args, 'verification', PIPELINE_STEP_TYPE.PLAN_FALLBACK);

  if (isParseFailure(verification)) {
    return verification;
  }
  if (rawRequirements !== undefined && !isRecord(rawRequirements)) {
    return failure(`${PIPELINE_STEP_TYPE.PLAN_FALLBACK} args: requirements must be an object.`);
  }

  const requirements: ParseResult<ProxyRouteRequirements | undefined> =
    rawRequirements === undefined
      ? success(undefined)
      : parseRouteRequirements(rawRequirements, PIPELINE_STEP_TYPE.PLAN_FALLBACK);

  if (isParseFailure(requirements)) {
    return requirements;
  }

  const verificationRequirements: ParseResult<ProxyRouteRequirements['verification'] | undefined> =
    verification.value === undefined
      ? success(undefined)
      : parseVerificationRequirements(verification.value, PIPELINE_STEP_TYPE.PLAN_FALLBACK);

  if (isParseFailure(verificationRequirements)) {
    return verificationRequirements;
  }

  const mergedRequirements = mergeAttemptRequirements(
    stateRequirements,
    requirements.value,
    verificationRequirements.value,
  );

  if (provider !== undefined) {
    return success(hasRequirements(mergedRequirements) ? mergedRequirements : undefined);
  }

  return success(constrainRequirementsToCandidates(mergedRequirements, candidateIds));
}

function mergeAttemptRequirements(
  stateRequirements: ProxyRouteRequirements,
  attemptRequirements: ProxyRouteRequirements | undefined,
  verificationRequirements: ProxyRouteRequirements['verification'] | undefined,
): ProxyRouteRequirements {
  const attemptWithVerification =
    verificationRequirements === undefined
      ? attemptRequirements
      : mergeProxyRouteRequirements(attemptRequirements ?? {}, {
          verification: verificationRequirements,
        });

  return mergeProxyRouteRequirements(stateRequirements, attemptWithVerification) ?? {};
}

function constrainRequirementsToCandidates(
  requirements: ProxyRouteRequirements,
  candidateIds: string[],
): ProxyRouteRequirements {
  const requiredIds = requirements.providerInstanceIds;
  const providerInstanceIds =
    requiredIds === undefined
      ? candidateIds
      : candidateIds.filter((candidateId) => requiredIds.includes(candidateId));

  return {
    ...requirements,
    providerInstanceIds,
  };
}

function readPlanService(services: ProxyGatewayServices): IPlanService | undefined {
  const planner = services.planner;

  return isPlanService(planner) ? planner : undefined;
}

function isPlanService(value: unknown): value is IPlanService {
  return isRecord(value) && typeof Reflect.get(value, 'plan') === 'function';
}

function rejectPlannerResult(
  plannerResult: Extract<ExecutionPlannerResult, { kind: PLANNER_RESULT_KIND.REJECTED }>,
): ProxyPipelineStepResult {
  return {
    decision: {
      code: plannerResult.code,
      kind: PIPELINE_DECISION_KIND.REJECT,
      message: plannerResult.message,
      status: 500,
    },
  };
}

function rejectGatewayError(message: string): ProxyPipelineStepResult {
  return {
    decision: {
      code: RESPONSE_CODE.GATEWAY_ERROR,
      kind: PIPELINE_DECISION_KIND.REJECT,
      message,
      status: 500,
    },
  };
}

function hasRequirements(requirements: ProxyRouteRequirements): boolean {
  return Object.keys(requirements).length > 0;
}

function readOptionalString(
  args: Record<string, unknown>,
  key: string,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<string | undefined> {
  const value = args[key];

  if (value === undefined) {
    return success(undefined);
  }
  if (typeof value !== 'string') {
    return failure(`${stepType} args: ${key} must be a string.`);
  }

  return success(value);
}

function readOptionalNumber(
  args: Record<string, unknown>,
  key: string,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<number | undefined> {
  const value = args[key];

  if (value === undefined) {
    return success(undefined);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return failure(`${stepType} args: ${key} must be a finite number.`);
  }

  return success(value);
}

function readOptionalBoolean(
  args: Record<string, unknown>,
  key: string,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<boolean | undefined> {
  const value = args[key];

  if (value === undefined) {
    return success(undefined);
  }
  if (typeof value !== 'boolean') {
    return failure(`${stepType} args: ${key} must be a boolean.`);
  }

  return success(value);
}

function readOptionalRecord(
  args: Record<string, unknown>,
  key: string,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<Record<string, unknown> | undefined> {
  const value = args[key];

  if (value === undefined) {
    return success(undefined);
  }
  if (!isRecord(value)) {
    return failure(`${stepType} args: ${key} must be an object.`);
  }

  return success(value);
}

function readOptionalRetryConditions(
  args: Record<string, unknown>,
  key: string,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<RETRY_CONDITION[] | undefined> {
  const value = args[key];

  if (value === undefined) {
    return success(undefined);
  }
  if (!Array.isArray(value)) {
    return failure(`${stepType} args: ${key} must be an array of retry condition values.`);
  }

  const retryConditions: RETRY_CONDITION[] = [];

  for (const entry of value) {
    if (typeof entry !== 'string') {
      return failure(`${stepType} args: ${key} must be an array of retry condition values.`);
    }

    const retryCondition = parseRetryCondition(entry);

    if (retryCondition === undefined) {
      return failure(`${stepType} args: ${key} contains an unsupported retry condition.`);
    }

    retryConditions.push(retryCondition);
  }

  return success(retryConditions);
}

function parseRetryCondition(value: string): RETRY_CONDITION | undefined {
  switch (value) {
    case RETRY_CONDITION.EXIT_VERIFICATION_FAILED:
    case RETRY_CONDITION.GATEWAY_TIMEOUT:
    case RETRY_CONDITION.HTTP_403:
    case RETRY_CONDITION.HTTP_407:
    case RETRY_CONDITION.HTTP_408:
    case RETRY_CONDITION.HTTP_409:
    case RETRY_CONDITION.HTTP_425:
    case RETRY_CONDITION.HTTP_429:
    case RETRY_CONDITION.HTTP_500:
    case RETRY_CONDITION.HTTP_502:
    case RETRY_CONDITION.HTTP_503:
    case RETRY_CONDITION.HTTP_504:
    case RETRY_CONDITION.PROXY_AUTH_ERROR:
    case RETRY_CONDITION.PROXY_CONNECTION_ERROR:
    case RETRY_CONDITION.PROXY_GEO_MISMATCH:
    case RETRY_CONDITION.PROXY_TIMEOUT:
    case RETRY_CONDITION.TARGET_NETWORK_ERROR:
    case RETRY_CONDITION.TARGET_TIMEOUT:
      return value;
    default:
      return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function success<TValue>(value: TValue): IParseSuccess<TValue> {
  return {
    ok: true,
    value,
  };
}

function failure(message: string): IParseFailure {
  return {
    message,
    ok: false,
  };
}
