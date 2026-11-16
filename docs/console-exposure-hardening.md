# Console exposure controls

This branch builds on the complete Arco console. The changes are limited to the
Console HTTP surface and browser storage names, with a separate optional switch
for full Server/Admin HTTP state. Defaults preserve existing consumers; SDK business
routes, gRPC messages, authentication credentials and cluster membership remain compatible.
They reduce public product identifiers; they do not make the underlying protocol
unrecognizable to a caller that can reach and use it.

## Optional server settings

The defaults preserve existing deployments. Configure the following in the
Console instance's `application.properties`, then restart that instance:

```properties
nacos.console.server-state.enabled=false
nacos.server.admin-state.enabled=false
nacos.console.server-state.minimal=true
nacos.console.ui.legacy.enabled=false
nacos.console.ui.notices.enabled=false
nacos.console.error.details.enabled=false
```

| Setting | Default | When changed |
| --- | --- | --- |
| `nacos.console.server-state.enabled` | `true` | When false, return empty HTTP 404 for Console state before invoking its handler. Native Next/Legacy still needs it; current Arco does not. |
| `nacos.server.admin-state.enabled` | `true` | When false, return empty HTTP 404 for full Server/Admin state only. Keep health probes and internal state services; independent Console/Maintainer HTTP state consumers must keep it enabled. |
| `nacos.console.server-state.minimal` | `false` | Return only login/UI capability fields from the public Console state endpoint. Exclude version, server port, startup mode, datasource and capacity details. Map the built-in auth display type to `local`; retain OIDC and other selected auth types for login routing. |
| `nacos.console.ui.legacy.enabled` | `true` | Reject Legacy HTML and its direct `/console-ui` resources with empty HTTP 404. If Legacy was the default, `/` selects Next instead. |
| `nacos.console.ui.notices.enabled` | `true` | Reject HTTP access to UI license/notice documents. Preserve these files and copyright notices in the distribution. |
| `nacos.console.error.details.enabled` | `true` | Replace the Console's generic framework error fallback with neutral JSON errors. Typed business validation and authentication errors keep their existing contracts. |

When Console state remains enabled, minimal mode returns a flat JSON object for
native UI bootstrap. Its fields
are `auth_enabled`, `auth_admin_request`, `login_page_enabled`,
`console_ui_enabled`, `console_ui_default`, `function_mode`, `ai_enabled`,
`copilot_enabled` and `auth_system_type`, when supplied by the server. The same
projection applies to anonymous and logged-in requests; sending an arbitrary
token header does not unlock detailed state. The separate enabled switches take
precedence over projection. Health probes are unaffected. OIDC is retained because the native login page needs
it to choose the correct authentication flow.

The Legacy and notice controls apply to direct resources as well as navigation
entries. The Legacy switch also covers the two bundled Legacy product logos at
`/img/nacos.png` and `/img/logo-2000-390.svg`, leaving custom image paths available.
Enabling Legacy again restores the existing pages without rebuilding.
Legal notices stay in the JAR and downloadable release. Operators distributing
the product must continue to provide the applicable license and attribution.

Existing optional presentation settings can also be used:

```properties
nacos.server.console-tip.enabled=false
nacos.console.brand.name=Service Platform
nacos.console.brand.show-version=false
```

AI and Copilot availability remain controlled independently by
`nacos.extension.ai.enabled` and `nacos.copilot.enabled`.

The distribution defaults for optional `console-guide.conf` and language-specific
`announcement_*.conf` presentation files are empty in this branch. Operators may
provide deployment-specific text, or leave unused files empty. Their public APIs
continue to return the configured presentation content; the minimal-state switch
does not rewrite operator announcements.

Current Arco requests namespaces after login and does not call Console state,
guide or announcement. AI/Copilot menus and direct routes use local runtime
`enableAi` and `enableCopilot`, both false by default and enabled only by literal
boolean true. Login remains responsible for session and administrator identity;
the backend still enforces real capabilities, function mode and authorization.
To use AI features later, enable the corresponding display flag and backend
feature together. A closed state API does not prevent current Arco initialization;
native UIs must retain their state endpoint.

## Browser identifiers

Arco runtime configuration uses a neutral, configurable `storagePrefix`.
Changing the prefix changes that installation's session, namespace and theme
storage. An optional temporary `legacyStoragePrefix` can migrate existing
browser data. Remove that migration setting after the upgrade window; its value
is public runtime configuration. Without migration, browser users sign in again
once. SDK credentials and application connections are unaffected.

## Network exposure

Application source networks are deployment-specific, so this branch does not
change a running firewall or guess an allowlist. A reverse proxy alone does not
restrict direct access to an upstream port. Apply both parts:

1. Expose the Console through the existing HTTPS gateway. Allow the Console port
   only from that gateway or the operations network. The example below preserves
   the configured Console context path and relative static assets.
2. Allow HTTP/SDK ports only from authorized application hosts or networks.
   Allow inter-server gRPC and Raft ports only between cluster nodes. Include
   IPv4 and IPv6 policy and local monitoring as applicable.

| Existing default port | Allowed callers |
| --- | --- |
| `8848` | Application clients and required internal administration |
| `9848` | Application gRPC clients |
| `9849` | Cluster nodes |
| `7848` | Cluster Raft peers |
| Console deployment port | Operations gateway/network |

Keep application `serverAddr` values and the existing HTTP-to-gRPC port offset
when preserving client configuration. Do not route gRPC through an ordinary
HTTP location. If ports are remapped deliberately, provide the corresponding
TCP/gRPC forwarding and validate each client version before switching traffic.
Server/Admin full state is disabled only when its dedicated switch is false.
Health probes keep their existing behavior. Restrict the upstream port at the
network boundary even when full state is disabled; trusted SDK/monitoring traffic
still needs the relevant health and business interfaces.

Example inside an existing Nginx HTTPS `server` block:

```nginx
server_tokens off;

# Match the existing nacos.console.contextPath; here it is /control.
location /control/ {
    proxy_pass http://127.0.0.1:18090;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_http_version 1.1;
    proxy_buffering off;
    # Preserve Result bodies, validation errors and authentication responses.
    proxy_intercept_errors off;
}
```

Keep the production Arco `apiBase` on the same public origin/context path.
Configure any Console CORS policy for the actual operations origin. Do not trust
client-supplied forwarded headers as proof of authorization or source identity.

## Validation

Focused Java tests cover default compatibility, minimal state, OIDC routing data,
direct resource restrictions and generic error behavior. API IT runs use separate
default and restricted server configurations; their scenario matrix is maintained
in `test/openapi-test/CONSOLE_API_TEST_SCENARIOS.md`. Arco checks cover browser
storage migration, session expiry, demo isolation, and the existing page workflows.

The earlier source revision `306865d08` was verified on 2026-11-16 against an
isolated standalone JVM deployment:

- 40 focused Console Java tests; Spotless apply/check, Checkstyle, Apache RAT and
  SpotBugs passed.
- 116 frontend unit tests, TypeScript/ESLint/build, four packaging tests,
  15 browser session/configuration checks and 22 AI demo/permission checks passed.
- Nine external HTTP ITs passed with default settings and nine with the restricted
  settings. Packaged notice trailing-slash URLs and Legacy scripts/logos were
  verified against the running server. The minimal response excluded version and
  server port while retaining login and feature flags.
- Java 8 / SDK 2.2.3 completed configuration publish/read/update/listener/delete
  and ephemeral service registration/discovery/deregistration with both profiles.
- The real browser completed eight management workflows and 43 successful API
  requests. Its strict no-runtime-error check remains unsuccessful: navigating
  from configurations to history reproducibly triggers an Arco 2.66.18 Table
  callback assigning `scrollLeft` after its DOM ref is cleared. Serial testing and
  removal of the pre-navigation screenshot reproduced it. The dependency and
  configuration/history Table implementations are unchanged in this branch; a
  separate fix is needed for that existing framework race.

No production firewall, service, configuration or data is modified by creating or
checking out this branch. A deployment must explicitly select its settings and
authorized application/cluster source networks.

That earlier build subsequently passed an isolated three-node cluster regression,
including leader loss, SDK reconnect/redo, recovery and eventual cleanup. See the
[cluster validation record](console-hardening-cluster-validation.md) for the exact
source/artifact, evidence scope and observed cleanup latency.

### State-independent Arco and optional state endpoint closure

The subsequent increment removes Arco state discovery and adds the two endpoint
enabled switches. A fresh integrated artifact was verified with three isolated
server configurations: compatibility defaults, minimal/restricted state, and both
full state endpoints disabled. All ten external HTTP ITs passed in each profile
(30 total), including notice boundaries, guide/announcement, typed validation and
health probes. Duplicate separators rejected by the container may return 400;
canonical closed state requests require empty 404.

- 43 focused Console and nine Core tests passed, including default response
  compatibility, disabled GET/HEAD without state-service calls and unchanged health.
  Spotless, Checkstyle, Apache RAT and SpotBugs checks passed in the changed Java modules.
- 117 frontend unit tests, four packaging tests, 19 base browser checks and
  23 explicit-opt-in AI browser checks passed. State/guide/announcement were
  exercised as unavailable mock endpoints with zero frontend requests.
- A real authenticated browser with both state endpoints disabled completed login,
  configuration/service/namespace navigation and AI route denial with seven API
  requests, zero discovery requests and zero runtime errors. This focused check
  does not fix or supersede the earlier Arco Table/history race.
- Java 8 / SDK 2.2.3 passed configuration CRUD/listener, naming registration,
  discovery/deregistration and server-status checks with default and closed-state
  settings. Twelve real GET/HEAD checks with anonymous, invalid and admin identities
  confirmed both closed endpoints return empty 404. Four Server/Console health
  probes remained successful. Local test processes and data were removed afterward.

The prior three-node record covers its pinned earlier source and artifact. This
later HTTP-closure increment has the standalone/SDK evidence above; no additional
three-node run is claimed for it.

Separately, the three display files in the existing server installation were
backed up and emptied at the user's request. Their public guide/announcement
responses were verified empty without restarting the business service. The
distribution defaults are also empty to avoid restoring product links on a fresh
installation. This maintenance did not deploy the new JAR or close the business
server's state endpoints; those switches require updating to this branch's artifact.
