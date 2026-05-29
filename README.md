# IT Glue MCP Server

A Model Context Protocol (MCP) server that provides Claude with access to IT Glue documentation and asset management.

## One-Click Deployment

[![Deploy to DO](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/wyre-technology/itglue-mcp/tree/main)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/wyre-technology/itglue-mcp)

## Installation

```bash
npm install @wyre-technology/itglue-mcp
```

Or use the Docker image:

```bash
docker pull ghcr.io/wyre-technology/itglue-mcp:latest
```

## Configuration

The server accepts credentials via environment variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `ITGLUE_API_KEY` | Your IT Glue API key (format: ITG.xxx) | Yes (env mode) |
| `ITGLUE_REGION` | API region: `us`, `eu`, or `au` (default: `us`) | No |
| `MCP_TRANSPORT` | Transport: `stdio` (local) or `http` (remote). Defaults to `stdio` when run via `npx`/`node`, and to `http` in the Docker image. | No |
| `MCP_HTTP_PORT` | Port for HTTP transport (default: `8080`) | No |
| `MCP_HTTP_HOST` | Bind address for HTTP transport (default: `0.0.0.0`) | No |
| `AUTH_MODE` | `env` (read credentials from environment) or `gateway` (read per-request credentials from HTTP headers). Default: `env`. | No |

Alternative: When `AUTH_MODE=gateway`, the MCP Gateway injects credentials per request via HTTP headers instead of environment variables. See [Remote Deployment](#remote-deployment-http-streamable).

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
