import {
  PIPELINE_DECISION_KIND,
  PIPELINE_STEP_TYPE,
  RESPONSE_CODE,
} from '../../constants';
import type {
  ProxyGatewayServices,
  ProxyPipelineStep,
  ProxyPipelineStepResult,
  ProxyProviderCandidate,
} from '../../ports/outbound';

interface IParseSuccess<TValue> {
  ok: true;
  value: TValue;
}

interface IParseFailure {
  message: string;
  ok: false;
}

interface IRankedCandidate {
  candidate: ProxyProviderCandidate;
  index: number;
  score: number;
}

interface IRandomFloatService {
  nextFloat(): number;
}

type ParseResult<TValue> = IParseFailure | IParseSuccess<TValue>;

const DEFAULT_RANDOM_FLOAT = 0.5;

export function createBuiltInProviderSteps(): ProxyPipelineStep[] {
  return [
    createStep(PIPELINE_STEP_TYPE.PROVIDERS_INCLUDE, async (input) => {
      const parsed = readRequiredStringArray(input.args, 'providerInstanceIds', PIPELINE_STEP_TYPE.PROVIDERS_INCLUDE);

      return isParseFailure(parsed)
        ? rejectInvalidArgs(parsed.message)
        : {
            statePatch: {
              candidates: input.state.candidates.filter((candidate) =>
                parsed.value.includes(candidate.providerInstanceId),
              ),
            },
          };
    }),
    createStep(PIPELINE_STEP_TYPE.PROVIDERS_EXCLUDE, async (input) => {
      const parsed = readRequiredStringArray(input.args, 'providerInstanceIds', PIPELINE_STEP_TYPE.PROVIDERS_EXCLUDE);

      return isParseFailure(parsed)
        ? rejectInvalidArgs(parsed.message)
        : {
            statePatch: {
              candidates: input.state.candidates.filter(
                (candidate) => !parsed.value.includes(candidate.providerInstanceId),
              ),
            },
          };
    }),
    createStep(PIPELINE_STEP_TYPE.PROVIDERS_TAGS, async (input) => {
      const parsed = readRequiredStringArray(input.args, 'tags', PIPELINE_STEP_TYPE.PROVIDERS_TAGS);

      return isParseFailure(parsed)
        ? rejectInvalidArgs(parsed.message)
        : {
            statePatch: {
              candidates: input.state.candidates.filter((candidate) => candidateHasAllTags(candidate, parsed.value)),
            },
          };
    }),
    createStep(PIPELINE_STEP_TYPE.PROVIDERS_PRIORITY, async (input) => ({
      statePatch: {
        candidates: rankCandidatesByPriority(input.state.candidates),
      },
    })),
    createStep(PIPELINE_STEP_TYPE.PROVIDERS_WEIGHTED, async (input) => ({
      statePatch: {
        candidates: rankCandidatesByWeight(input.state.candidates, readRandomFloatService(input.services)),
      },
    })),
  ];
}

function createStep(type: PIPELINE_STEP_TYPE, execute: ProxyPipelineStep['execute']): ProxyPipelineStep {
  return {
    execute,
    type,
  };
}

function candidateHasAllTags(candidate: ProxyProviderCandidate, tags: string[]): boolean {
  return tags.every((tag) => candidate.tags?.includes(tag) === true);
}

function rankCandidatesByPriority(candidates: ProxyProviderCandidate[]): ProxyProviderCandidate[] {
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: candidate.priority ?? 0,
    }))
    .sort(compareRankedCandidates)
    .map(({ candidate }) => candidate);
}

function rankCandidatesByWeight(
  candidates: ProxyProviderCandidate[],
  randomService: IRandomFloatService | undefined,
): ProxyProviderCandidate[] {
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: Math.log(readRandomFloat(randomService)) / readCandidateWeight(candidate),
    }))
    .sort(compareRankedCandidates)
    .map(({ candidate }) => candidate);
}

function compareRankedCandidates(left: IRankedCandidate, right: IRankedCandidate): number {
  const scoreDelta = right.score - left.score;

  return scoreDelta === 0 ? left.index - right.index : scoreDelta;
}

function readCandidateWeight(candidate: ProxyProviderCandidate): number {
  return candidate.weight === undefined || !Number.isFinite(candidate.weight) || candidate.weight <= 0
    ? 1
    : candidate.weight;
}

function readRandomFloat(randomService: IRandomFloatService | undefined): number {
  const rawValue = randomService?.nextFloat() ?? DEFAULT_RANDOM_FLOAT;

  if (!Number.isFinite(rawValue)) {
    return DEFAULT_RANDOM_FLOAT;
  }
  if (rawValue <= 0) {
    return Number.MIN_VALUE;
  }
  if (rawValue >= 1) {
    return 1 - Number.EPSILON;
  }

  return rawValue;
}

function readRandomFloatService(services: ProxyGatewayServices): IRandomFloatService | undefined {
  const randomService = services.random;

  if (!isRecord(randomService)) {
    return undefined;
  }

  const nextFloat = Reflect.get(randomService, 'nextFloat');

  if (typeof nextFloat !== 'function') {
    return undefined;
  }

  return {
    nextFloat: () => {
      const value: unknown = Reflect.apply(nextFloat, randomService, []);

      return typeof value === 'number' ? value : DEFAULT_RANDOM_FLOAT;
    },
  };
}

function rejectInvalidArgs(message: string): ProxyPipelineStepResult {
  return {
    decision: {
      code: RESPONSE_CODE.PIPELINE_STEP_INVALID_ARGS,
      kind: PIPELINE_DECISION_KIND.REJECT,
      message: `Invalid ${message}`,
      status: 400,
    },
  };
}

function readRequiredStringArray(
  args: Record<string, unknown>,
  key: string,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<string[]> {
  const value = args[key];

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    return failure(`${stepType} args: ${key} must be an array of strings.`);
  }

  return success(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isParseFailure<TValue>(result: ParseResult<TValue>): result is IParseFailure {
  return !result.ok;
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
