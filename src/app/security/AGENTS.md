# AGENTS.md - Target Access

The gateway is a powerful SSRF surface. Secure defaults are required.

Defaults:

```txt
- allow only http: and https: target schemes;
- deny localhost by default;
- deny private, loopback, link-local, multicast, reserved, and unspecified IP ranges by default;
- deny .onion targets unless explicitly allowed;
- do not perform DNS intelligence inside the core.
```

Denied address ranges must be represented as CIDR/range constants in `src/constants.ts`, not individual blocked URL strings.

Target access policy only decides whether the target is allowed at all. `.onion` route capability checks stay with provider/transport capability planning and execution.

If initial target access is denied, return before provider capability lookup, provider acquire, release, target transport execution, or verifier execution.

Target transports may receive `TargetFinalUrlGuardPort` and call it for redirect/final URL checks. The core provides this guard from the same target access policy, but it does not orchestrate redirect chains itself.
