# [1.1.0](https://github.com/wyre-technology/itglue-mcp/compare/v1.0.0...v1.1.0) (2026-02-18)


### Bug Fixes

* **ci:** deduplicate step IDs and use Node 22 for semantic-release ([ff8b086](https://github.com/wyre-technology/itglue-mcp/commit/ff8b086f7945a0194b4a0f2dc12a32e47ee420ce))
* **ci:** fix release workflow failures ([d0c4bc7](https://github.com/wyre-technology/itglue-mcp/commit/d0c4bc72b1a113b89cb4adb65bbe54ca41743dc5))
* **docker:** drop arm64 platform to fix QEMU build failures ([fd96d07](https://github.com/wyre-technology/itglue-mcp/commit/fd96d07cf79dbe5aa795a1687e06ddb68401375d))
* escape newlines in .releaserc.json message template ([741b678](https://github.com/wyre-technology/itglue-mcp/commit/741b67801d4b2020549d6afcd7580f7d96695fd0))
* use correct org-scoped endpoint for search_documents ([b1be590](https://github.com/wyre-technology/itglue-mcp/commit/b1be59043a31ed2994ff740d59e4f2b993bf67f7))
* use stateless per-request server pattern for HTTP transport ([a28d4e1](https://github.com/wyre-technology/itglue-mcp/commit/a28d4e195d47db1879f5a969d5e23fdba8fb8182))


### Features

* add HTTP transport + gateway auth mode support ([01da61f](https://github.com/wyre-technology/itglue-mcp/commit/01da61f7c55e8159224b15a35fcc3f14b701a254))
* add MCPB manifest for desktop installation ([6309e69](https://github.com/wyre-technology/itglue-mcp/commit/6309e691b3a56f447ff2a5fc3149acc6fec64a8c))
* add MCPB pack script ([d5cd1ba](https://github.com/wyre-technology/itglue-mcp/commit/d5cd1baf58af14752041e6055e0faaf926724044))
* add mcpb packaging support ([f5e7133](https://github.com/wyre-technology/itglue-mcp/commit/f5e7133b24dad56be55d308be4fda8c08cb6ca44))
* add mcpb packaging support ([bb70b62](https://github.com/wyre-technology/itglue-mcp/commit/bb70b623269ec0c5157033b8039d8362147d312a))
* add mcpb packaging support ([af26b49](https://github.com/wyre-technology/itglue-mcp/commit/af26b49335fae13091227ac148e5005828be1482))
* add mcpb packaging support ([80ee82f](https://github.com/wyre-technology/itglue-mcp/commit/80ee82fea4e75f4619c2b266f66ce98c535e23c6))
* add mcpb packaging support ([d9b36c8](https://github.com/wyre-technology/itglue-mcp/commit/d9b36c82102c98a771a359952b25de7178053f2d))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial MCP server implementation
- Tool: `search_organizations` - Search organizations with filtering
- Tool: `get_organization` - Get organization by ID
- Tool: `search_configurations` - Search configurations/devices
- Tool: `get_configuration` - Get configuration by ID
- Tool: `search_passwords` - Search password entries (metadata only)
- Tool: `get_password` - Get password with actual value
- Tool: `search_documents` - Search documents
- Tool: `search_flexible_assets` - Search flexible assets by type
- Tool: `itglue_health_check` - API connectivity check
- Docker support with multi-stage build
- GitHub Actions CI/CD pipeline
- Semantic release automation
