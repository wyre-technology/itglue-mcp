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
| `ITGLUE_API_KEY` | Your IT Glue API key (format: ITG.xxx) | Yes |
| `ITGLUE_REGION` | API region: `us`, `eu`, or `au` (default: `us`) | No |

Alternative: The MCP Gateway can inject credentials via `X_API_KEY` header.

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

Or with Docker:

```json
{
  "mcpServers": {
    "itglue": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "-e", "ITGLUE_API_KEY", "ghcr.io/wyre-technology/itglue-mcp:latest"],
      "env": {
        "ITGLUE_API_KEY": "${ITGLUE_API_KEY}"
      }
    }
  }
}
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
