# Console exposure controls

This branch builds on the complete Arco console. The changes are limited to the
Console HTTP surface and browser storage names. Server, Admin and SDK routes,
gRPC messages, authentication credentials and cluster membership remain compatible.
They reduce public product identifiers; they do not make the underlying protocol
unrecognizable to a caller that can reach and use it.

## Optional server settings

The defaults preserve existing deployments. Configure the following in the
Console instance's `application.properties`, then restart that instance:

```properties
nacos.console.server-state.minimal=true
nacos.console.ui.legacy.enabled=false
nacos.console.ui.notices.enabled=false
nacos.console.error.details.enabled=false
```

| Setting | Default | When changed |
| --- | --- | --- |
| `nacos.console.server-state.minimal` | `false` | Return only login/UI capability fields from the public Console state endpoint. Exclude version, server port, startup mode, datasource and capacity details. Map the built-in auth display type to `local`; retain OIDC and other selected auth types for login routing. |
| `nacos.console.ui.legacy.enabled` | `true` | Reject Legacy HTML and its direct `/console-ui` resources with empty HTTP 404. If Legacy was the default, `/` selects Next instead. |
| `nacos.console.ui.notices.enabled` | `true` | Reject HTTP access to UI license/notice documents. Preserve these files and copyright notices in the distribution. |
| `nacos.console.error.details.enabled` | `true` | Replace the Console's generic framework error fallback with neutral JSON errors. Typed business validation and authentication errors keep their existing contracts. |

Minimal state still returns the flat JSON object used by current UIs. Its fields
are `auth_enabled`, `auth_admin_request`, `login_page_enabled`,
`console_ui_enabled`, `console_ui_default`, `function_mode`, `ai_enabled`,
`copilot_enabled` and `auth_system_type`, when supplied by the server. The same
projection applies to anonymous and logged-in requests; sending an arbitrary
token header does not unlock detailed state. Core Admin state and health probes
are unaffected. An OIDC provider name is retained because the login page needs
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

Review the existing optional `console-guide.conf` and language-specific
`announcement_*.conf` presentation files as well. Replace default product links
with deployment-specific text, or remove/empty unused files. Their public APIs
continue to return the configured presentation content; the minimal-state switch
does not rewrite operator announcements.

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
The intentionally public Server Admin state and health interfaces keep their
existing behavior. Restrict their port at the network boundary; Console response
projection does not hide a directly reachable Server API.

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

Verified on 2026-11-16 against an isolated standalone JVM deployment:

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
