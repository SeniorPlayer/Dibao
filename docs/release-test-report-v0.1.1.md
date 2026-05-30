# Dibao v0.1.1 Release Test Report

Test window: 2026-05-30 CST

Branch: `release/v0.1.1`

Workspace: `/Users/jeffreywang/dev/邸报`

## Release Decision

This report is the live evidence log for the v0.1.1 release branch. A release-blocking Load more regression was found after the first tag publish attempt, so the final `v0.1.1` tag and GHCR image must be republished from the fixed commit without changing the version number.

## Gate Results

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck --workspaces --if-present` | Pass | All workspaces typechecked at `0.1.1`. |
| `npm test --workspaces --if-present` | Pass | 20 test files, 310 tests passed across workspaces. |
| `npm run build --workspaces --if-present` | Pass | Server and workspace TS builds passed; Web production bundle built with the existing large-chunk warning. |
| `npm run spike:sqlite-vec` | Pass | sqlite-vec `v0.1.9`; FTS, KNN, row mapping, and rebuild checks passed. |
| `docker buildx build --platform linux/amd64 --load --secret id=dibao_sentry_config,src=config/sentry.json -t dibao:v0.1.1 .` | Pass | Built local release image with private Sentry build config. |
| Docker Sentry config verification | Pass | Runtime and browser bundle booleans were all true for `hasDsn`, `hasOrg`, and `hasProject`; no secret values were printed. |
| v0.1.1 fresh Docker install | Pass | Empty volume started healthy with `version: 0.1.1` and `setupCompleted:false`. |
| v0.1.0 -> v0.1.1 Docker upgrade | Pass | Previous-release volume started at `0.1.0`, upgraded to `0.1.1`, applied `018`, retained setup, and had `interest_cluster_calibrations`. |
| `docker compose config --quiet` | Pass | Compose config is valid after making the host port overridable with default `8080`. |
| `npm run smoke:docker-recommendation` | Pass | Provider setup, backfill, personalized recommendation mode, full embedding coverage, and recommended list passed. |
| `npm run perf:recommendation` | Pass | 20k-article benchmark regenerated `docs/recommendation-performance.md`; recommended API 60.6 ms, diagnostics/index API 161.9 ms. |
| `npm run e2e` | Pass | 17/17 Playwright desktop/mobile tests passed, including the Load more scroll-past ignore telemetry regression. |
| `git diff --check` | Pass | No whitespace errors before final release commit. |

## Synology Regression Evidence From Dev Validation

Before cutting this release branch, the v0.1.1 clustering fix was deployed to the Synology permanent test instance on the validated `dev` image `dibao:50d2dbb`.

Observed results:

- Active embedding index: `index_270d90228b112a72f300`
- SQL migration: `018_interest_cluster_calibrations.sql`
- Derived-data upgrade: `v0.1.1-interest-profile-calibration-rebuild`
- Calibration confidence: high
- Calibration samples: positive 160, negative 82, background 260
- Positive merge threshold: `0.7316`
- Negative merge threshold: `0.6956`
- Positive clusters: 39; singleton clusters: 12; max sample count: 14; sample sum: 121
- Negative clusters: 32; singleton clusters: 25; max sample count: 5; sample sum: 46
- Positive families: 5
- Negative families: 7
- Known regression articles were not assigned to the same broad cluster/family at the release acceptance threshold.
- Upgrade copy in the bundled Web app states that the migration does not rebuild embeddings and will not create API cost.

This Synology validation is not a replacement for release install/upgrade gates. It records the data-specific regression closure that motivated v0.1.1.

## Migration Verification

New SQL migration after v0.1.0:

- `018_interest_cluster_calibrations.sql`

Blocking derived-data upgrade:

- `v0.1.1-interest-profile-calibration-rebuild`

Embedding recomputation: not required and not performed by the migration.

## Docker Release Image

Target immutable image:

```text
ghcr.io/pls-1q43/dibao:v0.1.1
```

Moving aliases such as `stable` and `latest` must not be moved until the user approves the final tag/release operation.

Local Sentry verification for the release image:

```json
{
  "runtime": {
    "hasDsn": true,
    "hasOrg": true,
    "hasProject": true
  },
  "browser": {
    "hasDsn": true,
    "hasOrg": true,
    "hasProject": true
  }
}
```

The final GHCR image must be checked with the same boolean-only probe after the tag-triggered publish completes.
