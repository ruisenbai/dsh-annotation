# Security policy

## Supported versions

| Version  | Security updates |
| -------- | ---------------- |
| `0.1.x`  | Yes              |
| `<0.1.0` | No               |

Support also requires a DSH version listed in [Compatibility](docs/compatibility.md).

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private vulnerability reporting for this repository. If that feature is unavailable, contact the repository owner through the private address listed in the GitHub profile and include `dsh-inline-annotations security` in the subject.

Include:

- affected plugin and DSH versions;
- browser, operating system, and installation method;
- impact and attack prerequisites;
- minimal reproduction steps;
- suggested remediation, if known.

Do not include real API keys, credentials, Session logs, selected private text, or user data. Use synthetic examples.

## Response process

Maintainers will acknowledge a complete report when available, validate the issue, coordinate a fix and disclosure date, and credit the reporter unless anonymity is requested. Please allow a reasonable remediation window before public disclosure.

## Security-relevant design

- Unsent drafts remain in browser `localStorage`.
- Submitted content becomes ordinary DSH Session/model data.
- The plugin has no direct external network client or telemetry.
- Host admission validates the complete decoded batch and receiving Session identity.
- Assistant content uses DSH's untrusted Markdown renderer; acknowledgement markers are parsed as text, not HTML.

See [Privacy](docs/privacy.md) for the data lifecycle.
