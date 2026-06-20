import {
  PIPELINE_DECISION_KIND,
  PIPELINE_STEP_TYPE,
  PROXY_GEO_STRICTNESS,
  PROXY_IDENTITY_ISOLATION_SCOPE,
  PROXY_IDENTITY_ROTATION,
  RESPONSE_CODE,
} from '../../constants';
import type {
  ProxyDnsRequirements,
  ProxyGeoRequirements,
  ProxyIdentityRequirements,
  ProxyPipelineStep,
  ProxyPipelineStepResult,
  ProxyRouteRequirements,
  ProxyVerificationRequirements,
} from '../../ports/outbound';
import { mergeProxyRouteRequirements } from '../planning';

interface IParseSuccess<TValue> {
  ok: true;
  value: TValue;
}

interface IParseFailure {
  message: string;
  ok: false;
}

export type ParseResult<TValue> = IParseFailure | IParseSuccess<TValue>;

export function createBuiltInRequirementSteps(): ProxyPipelineStep[] {
  return [
    createStep(PIPELINE_STEP_TYPE.REQUIREMENTS_SET, async (input) => {
      const parsed = parseRouteRequirements(input.args, PIPELINE_STEP_TYPE.REQUIREMENTS_SET);

      return isParseFailure(parsed)
        ? rejectInvalidArgs(parsed.message)
        : {
            statePatch: {
              requirements: parsed.value,
            },
          };
    }),
    createStep(PIPELINE_STEP_TYPE.REQUIREMENTS_MERGE, async (input) => {
      const parsed = parseRouteRequirements(input.args, PIPELINE_STEP_TYPE.REQUIREMENTS_MERGE);

      return isParseFailure(parsed)
        ? rejectInvalidArgs(parsed.message)
        : {
            statePatch: {
              requirements: mergeRequiredRouteRequirements(input.state.requirements, parsed.value),
            },
          };
    }),
    createStep(PIPELINE_STEP_TYPE.REQUIREMENTS_IDENTITY, async (input) => {
      const parsed = parseIdentityRequirements(input.args, PIPELINE_STEP_TYPE.REQUIREMENTS_IDENTITY);

      return isParseFailure(parsed)
        ? rejectInvalidArgs(parsed.message)
        : {
            statePatch: {
              requirements: mergeRequiredRouteRequirements(input.state.requirements, {
                identity: parsed.value,
              }),
            },
          };
    }),
    createStep(PIPELINE_STEP_TYPE.REQUIREMENTS_GEO, async (input) => {
      const parsed = parseGeoRequirements(input.args, PIPELINE_STEP_TYPE.REQUIREMENTS_GEO);

      return isParseFailure(parsed)
        ? rejectInvalidArgs(parsed.message)
        : {
            statePatch: {
              requirements: mergeRequiredRouteRequirements(input.state.requirements, {
                geo: parsed.value,
              }),
            },
          };
    }),
    createStep(PIPELINE_STEP_TYPE.REQUIREMENTS_VERIFICATION, async (input) => {
      const parsed = parseVerificationRequirements(input.args, PIPELINE_STEP_TYPE.REQUIREMENTS_VERIFICATION);

      return isParseFailure(parsed)
        ? rejectInvalidArgs(parsed.message)
        : {
            statePatch: {
              requirements: mergeRequiredRouteRequirements(input.state.requirements, {
                verification: parsed.value,
              }),
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

function mergeRequiredRouteRequirements(
  currentRequirements: ProxyRouteRequirements,
  nextRequirements: ProxyRouteRequirements,
): ProxyRouteRequirements {
  return mergeProxyRouteRequirements(currentRequirements, nextRequirements) ?? nextRequirements;
}

export function rejectInvalidArgs(message: string): ProxyPipelineStepResult {
  return {
    decision: {
      code: RESPONSE_CODE.PIPELINE_STEP_INVALID_ARGS,
      kind: PIPELINE_DECISION_KIND.REJECT,
      message: `Invalid ${message}`,
      status: 400,
    },
  };
}

export function parseRouteRequirements(
  args: Record<string, unknown>,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<ProxyRouteRequirements> {
  const providerInstanceIds = readOptionalStringArray(args, 'providerInstanceIds', stepType);

  if (isParseFailure(providerInstanceIds)) {
    return providerInstanceIds;
  }

  const excludeProviderInstanceIds = readOptionalStringArray(args, 'excludeProviderInstanceIds', stepType);

  if (isParseFailure(excludeProviderInstanceIds)) {
    return excludeProviderInstanceIds;
  }

  const protocols = readOptionalStringArray(args, 'protocols', stepType);

  if (isParseFailure(protocols)) {
    return protocols;
  }

  const networkTypes = readOptionalStringArray(args, 'networkTypes', stepType);

  if (isParseFailure(networkTypes)) {
    return networkTypes;
  }

  const dnsRecord = readOptionalRecord(args, 'dns', stepType);

  if (isParseFailure(dnsRecord)) {
    return dnsRecord;
  }

  const geoRecord = readOptionalRecord(args, 'geo', stepType);

  if (isParseFailure(geoRecord)) {
    return geoRecord;
  }

  const identityRecord = readOptionalRecord(args, 'identity', stepType);

  if (isParseFailure(identityRecord)) {
    return identityRecord;
  }

  const verificationRecord = readOptionalRecord(args, 'verification', stepType);

  if (isParseFailure(verificationRecord)) {
    return verificationRecord;
  }

  const dns = dnsRecord.value === undefined ? success(undefined) : parseDnsRequirements(dnsRecord.value, stepType);

  if (isParseFailure(dns)) {
    return dns;
  }

  const geo = geoRecord.value === undefined ? success(undefined) : parseGeoRequirements(geoRecord.value, stepType);

  if (isParseFailure(geo)) {
    return geo;
  }

  const identity =
    identityRecord.value === undefined ? success(undefined) : parseIdentityRequirements(identityRecord.value, stepType);

  if (isParseFailure(identity)) {
    return identity;
  }

  const verification =
    verificationRecord.value === undefined
      ? success(undefined)
      : parseVerificationRequirements(verificationRecord.value, stepType);

  if (isParseFailure(verification)) {
    return verification;
  }

  return success({
    ...(providerInstanceIds.value === undefined ? {} : { providerInstanceIds: providerInstanceIds.value }),
    ...(excludeProviderInstanceIds.value === undefined
      ? {}
      : { excludeProviderInstanceIds: excludeProviderInstanceIds.value }),
    ...(protocols.value === undefined ? {} : { protocols: protocols.value }),
    ...(networkTypes.value === undefined ? {} : { networkTypes: networkTypes.value }),
    ...(dns.value === undefined ? {} : { dns: dns.value }),
    ...(geo.value === undefined ? {} : { geo: geo.value }),
    ...(identity.value === undefined ? {} : { identity: identity.value }),
    ...(verification.value === undefined ? {} : { verification: verification.value }),
  });
}

function parseDnsRequirements(
  args: Record<string, unknown>,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<ProxyDnsRequirements> {
  const resolution = readRequiredString(args, 'resolution', stepType);

  if (isParseFailure(resolution)) {
    return resolution;
  }

  const forbidLocalDnsLeak = readOptionalBoolean(args, 'forbidLocalDnsLeak', stepType);

  if (isParseFailure(forbidLocalDnsLeak)) {
    return forbidLocalDnsLeak;
  }

  return success({
    ...(forbidLocalDnsLeak.value === undefined ? {} : { forbidLocalDnsLeak: forbidLocalDnsLeak.value }),
    resolution: resolution.value,
  });
}

function parseGeoRequirements(
  args: Record<string, unknown>,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<ProxyGeoRequirements> {
  const asn = readOptionalNumber(args, 'asn', stepType);

  if (isParseFailure(asn)) {
    return asn;
  }

  const city = readOptionalString(args, 'city', stepType);

  if (isParseFailure(city)) {
    return city;
  }

  const country = readOptionalString(args, 'country', stepType);

  if (isParseFailure(country)) {
    return country;
  }

  const postalCode = readOptionalString(args, 'postalCode', stepType);

  if (isParseFailure(postalCode)) {
    return postalCode;
  }

  const region = readOptionalString(args, 'region', stepType);

  if (isParseFailure(region)) {
    return region;
  }

  const strictness = readOptionalGeoStrictness(args, 'strictness', stepType);

  if (isParseFailure(strictness)) {
    return strictness;
  }

  const verify = readOptionalBoolean(args, 'verify', stepType);

  if (isParseFailure(verify)) {
    return verify;
  }

  return success({
    ...(asn.value === undefined ? {} : { asn: asn.value }),
    ...(city.value === undefined ? {} : { city: city.value }),
    ...(country.value === undefined ? {} : { country: country.value }),
    ...(postalCode.value === undefined ? {} : { postalCode: postalCode.value }),
    ...(region.value === undefined ? {} : { region: region.value }),
    ...(strictness.value === undefined ? {} : { strictness: strictness.value }),
    ...(verify.value === undefined ? {} : { verify: verify.value }),
  });
}

function parseIdentityRequirements(
  args: Record<string, unknown>,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<ProxyIdentityRequirements> {
  const isolationKey = readOptionalString(args, 'isolationKey', stepType);

  if (isParseFailure(isolationKey)) {
    return isolationKey;
  }

  const isolationScope = readOptionalIsolationScopeArray(args, 'isolationScope', stepType);

  if (isParseFailure(isolationScope)) {
    return isolationScope;
  }

  const requestNewIdentity = readOptionalBoolean(args, 'requestNewIdentity', stepType);

  if (isParseFailure(requestNewIdentity)) {
    return requestNewIdentity;
  }

  const rotation = readOptionalIdentityRotation(args, 'rotation', stepType);

  if (isParseFailure(rotation)) {
    return rotation;
  }

  const stickySessionId = readOptionalString(args, 'stickySessionId', stepType);

  if (isParseFailure(stickySessionId)) {
    return stickySessionId;
  }

  const stickySessionTtlMs = readOptionalNumber(args, 'stickySessionTtlMs', stepType);

  if (isParseFailure(stickySessionTtlMs)) {
    return stickySessionTtlMs;
  }

  return success({
    ...(isolationKey.value === undefined ? {} : { isolationKey: isolationKey.value }),
    ...(isolationScope.value === undefined ? {} : { isolationScope: isolationScope.value }),
    ...(requestNewIdentity.value === undefined ? {} : { requestNewIdentity: requestNewIdentity.value }),
    ...(rotation.value === undefined ? {} : { rotation: rotation.value }),
    ...(stickySessionId.value === undefined ? {} : { stickySessionId: stickySessionId.value }),
    ...(stickySessionTtlMs.value === undefined ? {} : { stickySessionTtlMs: stickySessionTtlMs.value }),
  });
}

export function parseVerificationRequirements(
  args: Record<string, unknown>,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<ProxyVerificationRequirements> {
  const cacheTtlMs = readOptionalNumber(args, 'cacheTtlMs', stepType);

  if (isParseFailure(cacheTtlMs)) {
    return cacheTtlMs;
  }

  const maxVerificationAttempts = readOptionalNumber(args, 'maxVerificationAttempts', stepType);

  if (isParseFailure(maxVerificationAttempts)) {
    return maxVerificationAttempts;
  }

  const rejectOnGeoMismatch = readOptionalBoolean(args, 'rejectOnGeoMismatch', stepType);

  if (isParseFailure(rejectOnGeoMismatch)) {
    return rejectOnGeoMismatch;
  }

  const retryOnGeoMismatch = readOptionalBoolean(args, 'retryOnGeoMismatch', stepType);

  if (isParseFailure(retryOnGeoMismatch)) {
    return retryOnGeoMismatch;
  }

  const verificationTimeoutMs = readOptionalNumber(args, 'verificationTimeoutMs', stepType);

  if (isParseFailure(verificationTimeoutMs)) {
    return verificationTimeoutMs;
  }

  const verifyExit = readOptionalBoolean(args, 'verifyExit', stepType);

  if (isParseFailure(verifyExit)) {
    return verifyExit;
  }

  return success({
    ...(cacheTtlMs.value === undefined ? {} : { cacheTtlMs: cacheTtlMs.value }),
    ...(maxVerificationAttempts.value === undefined
      ? {}
      : { maxVerificationAttempts: maxVerificationAttempts.value }),
    ...(rejectOnGeoMismatch.value === undefined ? {} : { rejectOnGeoMismatch: rejectOnGeoMismatch.value }),
    ...(retryOnGeoMismatch.value === undefined ? {} : { retryOnGeoMismatch: retryOnGeoMismatch.value }),
    ...(verificationTimeoutMs.value === undefined ? {} : { verificationTimeoutMs: verificationTimeoutMs.value }),
    ...(verifyExit.value === undefined ? {} : { verifyExit: verifyExit.value }),
  });
}

function readOptionalRecord(
  record: Record<string, unknown>,
  propertyName: string,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<Record<string, unknown> | undefined> {
  const value = Reflect.get(record, propertyName);

  if (value === undefined) {
    return success(undefined);
  }

  return isRecord(value)
    ? success(value)
    : failure(`${stepType} args: ${propertyName} must be an object.`);
}

function readRequiredString(
  record: Record<string, unknown>,
  propertyName: string,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<string> {
  const value = Reflect.get(record, propertyName);

  return typeof value === 'string'
    ? success(value)
    : failure(`${stepType} args: ${propertyName} must be a string.`);
}

function readOptionalString(
  record: Record<string, unknown>,
  propertyName: string,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<string | undefined> {
  const value = Reflect.get(record, propertyName);

  if (value === undefined) {
    return success(undefined);
  }

  return typeof value === 'string'
    ? success(value)
    : failure(`${stepType} args: ${propertyName} must be a string.`);
}

function readOptionalNumber(
  record: Record<string, unknown>,
  propertyName: string,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<number | undefined> {
  const value = Reflect.get(record, propertyName);

  if (value === undefined) {
    return success(undefined);
  }

  return typeof value === 'number' && Number.isFinite(value)
    ? success(value)
    : failure(`${stepType} args: ${propertyName} must be a finite number.`);
}

function readOptionalBoolean(
  record: Record<string, unknown>,
  propertyName: string,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<boolean | undefined> {
  const value = Reflect.get(record, propertyName);

  if (value === undefined) {
    return success(undefined);
  }

  return typeof value === 'boolean'
    ? success(value)
    : failure(`${stepType} args: ${propertyName} must be a boolean.`);
}

function readOptionalStringArray(
  record: Record<string, unknown>,
  propertyName: string,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<string[] | undefined> {
  const value = Reflect.get(record, propertyName);

  if (value === undefined) {
    return success(undefined);
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    return failure(`${stepType} args: ${propertyName} must be an array of strings.`);
  }

  return success(value);
}

function readOptionalGeoStrictness(
  record: Record<string, unknown>,
  propertyName: string,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<PROXY_GEO_STRICTNESS | undefined> {
  const value = Reflect.get(record, propertyName);

  if (value === undefined) {
    return success(undefined);
  }

  switch (value) {
    case PROXY_GEO_STRICTNESS.BEST_EFFORT:
      return success(PROXY_GEO_STRICTNESS.BEST_EFFORT);
    case PROXY_GEO_STRICTNESS.PREFERRED:
      return success(PROXY_GEO_STRICTNESS.PREFERRED);
    case PROXY_GEO_STRICTNESS.REQUIRED:
      return success(PROXY_GEO_STRICTNESS.REQUIRED);
    default:
      return failure(`${stepType} args: ${propertyName} must be a proxy geo strictness value.`);
  }
}

function readOptionalIdentityRotation(
  record: Record<string, unknown>,
  propertyName: string,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<PROXY_IDENTITY_ROTATION | undefined> {
  const value = Reflect.get(record, propertyName);

  if (value === undefined) {
    return success(undefined);
  }

  switch (value) {
    case PROXY_IDENTITY_ROTATION.FIXED:
      return success(PROXY_IDENTITY_ROTATION.FIXED);
    case PROXY_IDENTITY_ROTATION.PER_REQUEST:
      return success(PROXY_IDENTITY_ROTATION.PER_REQUEST);
    case PROXY_IDENTITY_ROTATION.STICKY:
      return success(PROXY_IDENTITY_ROTATION.STICKY);
    default:
      return failure(`${stepType} args: ${propertyName} must be a proxy identity rotation value.`);
  }
}

function readOptionalIsolationScopeArray(
  record: Record<string, unknown>,
  propertyName: string,
  stepType: PIPELINE_STEP_TYPE,
): ParseResult<PROXY_IDENTITY_ISOLATION_SCOPE[] | undefined> {
  const value = Reflect.get(record, propertyName);

  if (value === undefined) {
    return success(undefined);
  }
  if (!Array.isArray(value)) {
    return failure(`${stepType} args: ${propertyName} must be an array of identity isolation scopes.`);
  }

  const scopes: PROXY_IDENTITY_ISOLATION_SCOPE[] = [];

  for (const entry of value) {
    const scope = readIsolationScope(entry);

    if (scope === undefined) {
      return failure(`${stepType} args: ${propertyName} must be an array of identity isolation scopes.`);
    }

    scopes.push(scope);
  }

  return success(scopes);
}

function readIsolationScope(value: unknown): PROXY_IDENTITY_ISOLATION_SCOPE | undefined {
  switch (value) {
    case PROXY_IDENTITY_ISOLATION_SCOPE.ATTEMPT:
      return PROXY_IDENTITY_ISOLATION_SCOPE.ATTEMPT;
    case PROXY_IDENTITY_ISOLATION_SCOPE.FLOW:
      return PROXY_IDENTITY_ISOLATION_SCOPE.FLOW;
    case PROXY_IDENTITY_ISOLATION_SCOPE.PROVIDER:
      return PROXY_IDENTITY_ISOLATION_SCOPE.PROVIDER;
    case PROXY_IDENTITY_ISOLATION_SCOPE.ROUTE:
      return PROXY_IDENTITY_ISOLATION_SCOPE.ROUTE;
    case PROXY_IDENTITY_ISOLATION_SCOPE.TARGET_HOST:
      return PROXY_IDENTITY_ISOLATION_SCOPE.TARGET_HOST;
    case PROXY_IDENTITY_ISOLATION_SCOPE.TENANT:
      return PROXY_IDENTITY_ISOLATION_SCOPE.TENANT;
    default:
      return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isParseFailure<TValue>(result: ParseResult<TValue>): result is IParseFailure {
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
