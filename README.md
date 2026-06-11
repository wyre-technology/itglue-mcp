# IT Glue MCP Server

A Model Context Protocol (MCP) server that provides Claude with access to IT Glue documentation and asset management.

## One-Click Deployment

[![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/wyre-technology/itglue-mcp/tree/main)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wyre-technology/itglue-mcp)

> [!NOTE]
> Unlike the other Wyre MCP servers, this one talks to the IT Glue API directly and
> has **no private `@wyre-technology/*` runtime dependency**, so the one-click build
> does not need a GitHub Packages token — the cloud builder's `npm ci` only pulls
> public packages. (A `read:packages` token is only needed to install the published
> `@wyre-technology/itglue-mcp` package itself; see [Installation](#installation).)
> The DigitalOcean target builds the full Docker image and runs the complete MCP
> server over HTTP and is the recommended path; this repo does not ship a Workers
> entrypoint (`src/worker.ts`), so prefer DigitalOcean or the prebuilt container
> image (`ghcr.io/wyre-technology/itglue-mcp`).

## Installation

This package is published to the **GitHub Packages** npm registry, which requires a
token even for public packages. Authenticate npm once, then install:

```bash
# Authenticate npm to GitHub Packages (token needs the read:packages scope)
export NODE_AUTH_TOKEN=$(gh auth token)   # or a PAT with read:packages

npm install @wyre-technology/itglue-mcp
```

The repo's `.npmrc` already points the `@wyre-technology` scope at GitHub Packages and
reads the token from `NODE_AUTH_TOKEN`, so no further config is needed. The same applies
to `npx @wyre-technology/itglue-mcp`.

Or use the Docker image:

```bash
docker pull ghcr.io/wyre-technology/itglue-mcp:latest
```

## Configuration

The server accepts credentials via environment variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `ITGLUE_API_KEY` | Your IT Glue API key (format: ITG.xxx) | Yes (env mode) |
| `ITGLUE_JWT` | A user-session JWT for elevated-scope operations such as listing document folders. See [JWT for document-folder operations](#jwt-for-document-folder-operations). | No |
| `ITGLUE_REGION` | API region: `us`, `eu`, or `au` (default: `us`) | No |
| `ITGLUE_BASE_URL` | Override the IT Glue API base URL (advanced) | No |
| `MCP_TRANSPORT` | Transport: `stdio` (local) or `http` (remote). Defaults to `stdio` when run via `npx`/`node`, and to `http` in the Docker image. | No |
| `MCP_HTTP_PORT` | Port for HTTP transport (default: `8080`) | No |
| `MCP_HTTP_HOST` | Bind address for HTTP transport (default: `0.0.0.0`) | No |
| `AUTH_MODE` | `env` (read credentials from environment) or `gateway` (read per-request credentials from HTTP headers). Default: `env`. | No |
| `ITG_EMAIL` / `ITG_PASSWORD` / `ITG_TOTP_SECRET` / `ITG_LOGIN_URL` | **Experimental.** Opt-in headless JWT auto-acquisition for folder navigation. See [Automatic JWT acquisition](#automatic-jwt-acquisition-experimental-headless-deployments) — read the security warning first. | No |

Alternative: When `AUTH_MODE=gateway`, the MCP Gateway injects credentials per request via HTTP headers instead of environment variables. See [Remote Deployment](#remote-deployment-http-streamable).

### JWT for document-folder operations

A handful of operations need more than an API key. IT Glue gates **document folders** behind a user-session JWT — the API-key scope can read and create documents, but it cannot enumerate folder names. Tools affected:

- `list_document_folders` — fails without a JWT.
- `create_document` — works without a JWT (falls back to a URL/ID folder prompt), but only offers the friendlier name-based folder picker when a JWT is present.

Provide the JWT in whichever way matches your deployment:

| Mode | How to supply the JWT |
|------|-----------------------|
| Local / env (`AUTH_MODE=env`) | Set the `ITGLUE_JWT` environment variable. |
| Remote gateway (`AUTH_MODE=gateway`) | Send the `X-ITGlue-JWT` request header. |
| Interactive clients (Claude Desktop/Code) | Leave it unset — the server prompts you to paste a JWT on first use and caches it for the session. |

> **Headless deployments (Docker, cloud):** there is no one to answer the interactive prompt, so you **must** set `ITGLUE_JWT` (env mode) or send `X-ITGlue-JWT` (gateway mode) for folder enumeration to work.

**Retrieving a JWT from your browser:**

1. Sign in to IT Glue in your browser.
2. Open DevTools → **Network** tab.
3. Click any request to `itg-api-*.itglue.com`.
4. Copy the value of the `Authorization: Bearer <token>` request header — the `<token>` part is your JWT.

> **Expiry:** IT Glue JWTs are short-lived (~2 hours). A JWT placed in `ITGLUE_JWT` on a long-running container will go stale and folder enumeration will start failing until it is refreshed. Interactive clients are simply re-prompted on expiry. API-key-only operations (everything except folder enumeration) are unaffected.

### Automatic JWT acquisition (experimental, headless deployments)

> **Status: experimental prototype (issue [#55](https://github.com/wyre-technology/itglue-mcp/issues/55)).** Not enabled by default and not recommended for general use yet. The login flow drives the live IT Glue web UI, which can change without notice. Test it against your own account before relying on it.

The 2-hour JWT expiry makes folder navigation impractical on headless Docker deployments — someone has to harvest a fresh token from a browser every couple of hours. As an opt-in alternative, the container can log in itself with a real (headless) browser, capture the user-session JWT, and keep it refreshed ahead of expiry. Set the credentials below and the server takes over `ITGLUE_JWT` for you:

| Variable | Description |
|----------|-------------|
| `ITG_EMAIL` | Login email (username) for the service account. |
| `ITG_PASSWORD` | That account's password. |
| `ITG_TOTP_SECRET` | The account's MFA seed (the base32 secret you would scan into an authenticator app), used to compute the OTP at login. |
| `ITG_LOGIN_URL` | Your account login URL, e.g. `https://<your-account>.itglue.com/login`. Required when the credentials above are set. |
| `ITG_LOGIN_ORG` | Your KaseyaOne organization name (the "organization" field on the login form). Usually required. |
| `ITG_BROWSER_PATH` | Optional path to a Chromium binary if not using Playwright's bundled one. |

When all of `ITG_EMAIL`, `ITG_PASSWORD`, and `ITG_TOTP_SECRET` are present (env mode only), the server logs in on startup, writes the captured JWT into `ITGLUE_JWT`, and refreshes it ~5 minutes before each expiry. If login fails, the server still starts and serves all API-key-only tools — only folder enumeration is affected. Gateway mode (per-request header credentials) is unaffected by these variables.

> **Login goes through KaseyaOne SSO.** IT Glue does not present a native login form — `https://<account>.itglue.com/login` redirects to KaseyaOne (`one.kaseya.com`, OIDC) and logs in over three steps: **username + organization → password → MFA**. The flow this prototype drives was verified live through the password step; the **MFA/OTP step was not completed end-to-end**, so its selectors are best-effort and may need tuning against your tenant. If your account uses a non-TOTP second factor (e.g. a push/device approval) rather than an authenticator code, automated login will not work at all.

This requires the optional `playwright-core` dependency **and** a Chromium binary in the image (neither is in the default build):

```dockerfile
# In a derived image, on top of the published itglue-mcp image:
USER root
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
RUN npm install playwright-core
ENV ITG_BROWSER_PATH=/usr/bin/chromium-browser
USER mcp
```

> ### ⚠️ Security warning — read before enabling
>
> These variables together hold **everything needed to authenticate as a human user, including bypassing that user's MFA** (the TOTP seed is the second factor). This is a materially larger blast radius than an API key. Treat it accordingly:
>
> - **Use a dedicated, least-privilege IT Glue service account** — never a human admin's credentials. Scope it to exactly the access folder enumeration needs.
> - **Store these as secrets**, never in an image layer, `docker-compose.yml`, or source control. Inject them at runtime (e.g. Docker/K8s secrets).
> - The server **never logs the credentials or the JWT**, but anyone with shell access to the container can read them from the environment. Restrict access.
> - **Rotate** the password and TOTP seed if the host is ever compromised, and prefer short credential lifetimes where your IT Glue plan allows.
> - This bypasses IT Glue's intended API-key boundary by automating their web UI. Confirm it is acceptable under your IT Glue agreement and your own security policy before using it.

## Available Tools

### Organizations

- **search_organizations** - Search for organizations with optional filtering by name, type, status, or PSA ID
- **get_organization** - Get a specific organization by ID

### Configurations (Devices/Assets)

- **search_configurations** - Search for configurations with filtering by organization, name, type, status, serial number, RMM ID, or PSA ID
- **get_configuration** - Get a specific configuration by ID

### Passwords

- **search_passwords** - Search for password entries (metadata only, no actual passwords in results)
- **get_password** - Get a specific password entry including the actual password value

### Documents

- **search_documents** - Search for documents with filtering by organization or name
- **list_document_folders** - List an organization's document folders (names and IDs). Requires a JWT — see [JWT for document-folder operations](#jwt-for-document-folder-operations)

### Flexible Assets

- **search_flexible_assets** - Search for flexible assets (requires flexible_asset_type_id)

### Utility

- **itglue_health_check** - Verify connectivity to IT Glue API

## Usage with Claude Code

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "itglue": {
      "command": "npx",
      "args": ["@wyre-technology/itglue-mcp"],
      "env": {
        "ITGLUE_API_KEY": "${ITGLUE_API_KEY}",
        "ITGLUE_REGION": "us"
      }
    }
  }
}
```

Or with Docker (local stdio):

```json
{
  "mcpServers": {
    "itglue": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "MCP_TRANSPORT=stdio",
        "-e", "ITGLUE_API_KEY",
        "ghcr.io/wyre-technology/itglue-mcp:latest"
      ],
      "env": {
        "ITGLUE_API_KEY": "${ITGLUE_API_KEY}"
      }
    }
  }
}
```

> **Note:** The Docker image defaults to HTTP transport. The `-e MCP_TRANSPORT=stdio` above is required to run it as a local stdio server for Claude Desktop/Code. For server deployments, see [Remote Deployment](#remote-deployment-http-streamable) below.

## Remote Deployment (HTTP Streamable)

For server/cloud deployments, run the server with the HTTP Streamable transport. The Docker image already defaults to `MCP_TRANSPORT=http` on port `8080`, exposing two endpoints:

- `POST /mcp` — MCP Streamable HTTP endpoint (stateless: a fresh server is created per request)
- `GET /health` — unauthenticated health check

### Env mode (single tenant)

Credentials come from environment variables. Use this when one API key serves the deployment:

```bash
docker run -d \
  --name itglue-mcp \
  -p 8080:8080 \
  -e ITGLUE_API_KEY="ITG.xxxxxxxx" \
  -e ITGLUE_REGION="us" \
  --restart unless-stopped \
  ghcr.io/wyre-technology/itglue-mcp:latest

# Verify
curl http://localhost:8080/health
# {"status":"ok","transport":"http","authMode":"env",...}
```

Clients connect to `http://<host>:8080/mcp` using the MCP Streamable HTTP transport.

### Gateway mode (multi-tenant / hosted)

When deployed behind an MCP Gateway (e.g. `mcp.wyre.ai`), set `AUTH_MODE=gateway`. Credentials are then injected per request via HTTP headers rather than environment variables:

```bash
docker run -d \
  --name itglue-mcp \
  -p 8080:8080 \
  -e AUTH_MODE=gateway \
  --restart unless-stopped \
  ghcr.io/wyre-technology/itglue-mcp:latest
```

The gateway supplies credentials on each request via these headers:

| Header | Description | Required |
|--------|-------------|----------|
| `X-ITGlue-API-Key` (or `X-API-Key`) | IT Glue API key | One of API-Key or JWT |
| `X-ITGlue-JWT` | JWT for elevated-scope operations | One of API-Key or JWT |
| `X-ITGlue-Region` | API region: `us`, `eu`, or `au` (default: `us`) | No |
| `X-ITGlue-Base-URL` | Override the IT Glue API base URL | No |

Requests missing both `X-ITGlue-API-Key` and `X-ITGlue-JWT` receive a `401`. The `/health` endpoint reports `"authMode":"gateway"` in this mode.

### Running without Docker

The same transport works from an installed/built copy by setting `MCP_TRANSPORT=http`:

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=8080 ITGLUE_API_KEY="ITG.xxxxxxxx" \
  npx @wyre-technology/itglue-mcp
```

## Example Queries

Once configured, you can ask Claude:

- "Search for organizations containing 'Acme' in IT Glue"
- "Get the configuration details for device ID 12345"
- "Find all passwords for organization ID 100"
- "Search for flexible assets of type 54321"

## Security Notes

- Password search results do not include actual password values for security
- Use `get_password` with explicit ID to retrieve password values
- Store your API key securely using environment variables or a secrets manager
- The API key should have appropriate read permissions in IT Glue

## License

Apache-2.0

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
