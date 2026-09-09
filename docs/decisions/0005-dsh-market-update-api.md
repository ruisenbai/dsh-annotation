# Decision 0005: Public dsh-market update API

Status: accepted

## Context

dsh-market `1.45.0` exposes `dsh-market/update-api/v1` for plugin-owned update controls. Its internal UI routes and response fields remain private, while installations may omit dsh-market or delegate Host restart to a desktop shell or operator. The public API currently reports beta stability.

## Decision

The Web Client adds update controls to the existing annotation settings card. It discovers `/dsh-market/api/v1/capabilities` on the first user request, validates the response schema and same-origin v1 endpoint paths, then checks only `dsh-annotation`. The Client starts one update operation and polls its public operation endpoint until a terminal state. It displays installed and latest versions, structured progress, and the bounded failure message returned by dsh-market.

Update installation is never reimplemented in this package. Force is exposed only after `RELEASE_TOO_FRESH` or `VERSION_UNCHANGED`. Rollback uses the completed operation id and appears only while dsh-market reports a retained recovery point. Refresh follows `refreshRequired`. Restart appears only when both the restart feature and `restart.supported` are true; desktop- and operator-owned Hosts keep their external restart path.

When discovery is unavailable or invalid, the card directs users to **Settings → Plugin Market**. It never calls legacy `/dsh-market/*` mutation routes, imports dsh-market implementation code, or assumes that the optional plugin is present. Client disposal aborts active requests and polling waits, then awaits settlement.

## Consequences

- dsh-market remains the sole owner of source selection, install policy, compatibility recovery, activation, and process control.
- The annotation package has no dsh-market peer dependency and still loads when Market is absent.
- Response validation and deterministic polling tests are required because all API values cross an HTTP interface.
- While v1 reports beta stability, each release must recheck the public document and keep an upstream dependency issue open.

The [compatibility guide](../compatibility.md#marketplace-update-api) records the supported API behavior and upgrade checks.
