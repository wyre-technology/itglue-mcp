// MCP Prompt Handlers for IT Glue MCP Server
// Exposes pre-baked prompt templates via ListPrompts and GetPrompt handlers

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

export function registerPromptHandlers(server: Server): void {
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: 'doc-completeness',
        description: 'Audit documentation completeness for an organization in IT Glue',
        arguments: [
          {
            name: 'org_name',
            description: 'The organization to audit',
            required: true,
          },
        ],
      },
      {
        name: 'runbook-check',
        description: 'Find systems or services without runbooks in IT Glue',
        arguments: [
          {
            name: 'org_name',
            description: 'The organization to check',
            required: true,
          },
          {
            name: 'system_name',
            description: 'Filter to a specific system or service (optional)',
            required: false,
          },
        ],
      },
      {
        name: 'password-audit',
        description: 'Find passwords that have not been rotated in 90+ days',
        arguments: [
          {
            name: 'org_name',
            description: 'The organization to audit passwords for',
            required: true,
          },
        ],
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'doc-completeness':
        return {
          description: 'Documentation completeness audit for an organization',
          messages: [
            {
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: [
                  `Audit documentation completeness for ${args?.org_name} in IT Glue.`,
                  '',
                  'Use the available IT Glue tools to:',
                  '1. Search for the organization by name to get its ID,',
                  '2. Retrieve all configurations (devices/assets) for the org,',
                  '3. Retrieve all documents (flexible assets, standard docs) for the org,',
                  '4. Check for the following documentation categories and flag any that are missing or sparse:',
                  '   - Network topology / diagram',
                  '   - Server and device inventory (is each configuration documented?)',
                  '   - Credentials / passwords (are key systems represented?)',
                  '   - Business continuity / disaster recovery plan',
                  '   - Onboarding / offboarding procedures',
                  '   - Backup and recovery documentation',
                  '5. Identify configurations that have no associated documents.',
                  '',
                  'Present as a documentation health report:',
                  '- Overall completeness score (rough estimate)',
                  '- Table of documented vs undocumented areas',
                  '- Prioritized list of documentation gaps to fill',
                ].join('\n'),
              },
            },
          ],
        };

      case 'runbook-check':
        return {
          description: 'Find systems without runbooks',
          messages: [
            {
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: [
                  `Check for missing runbooks in IT Glue for ${args?.org_name}${args?.system_name ? `, specifically for ${args.system_name}` : ''}.`,
                  '',
                  'A runbook is a document that describes how to operate, troubleshoot, or recover a specific system.',
                  '',
                  'Use the available IT Glue tools to:',
                  '1. Search for the organization and get its ID,',
                  '2. Retrieve all configurations (servers, network devices, key services) for the org,',
                  `3. ${args?.system_name ? `Focus on configurations matching "${args.system_name}"` : 'For each configuration'},`,
                  '   search for associated documents that serve as runbooks',
                  '   (look for docs with names containing: runbook, procedure, guide, how-to, SOP, or similar),',
                  '4. Identify any critical systems (servers, firewalls, switches) with no runbook,',
                  '5. Note any runbooks that appear outdated (if last-updated dates are available).',
                  '',
                  'Present as a runbook coverage report:',
                  '- Count of systems with vs without runbooks',
                  '- List of systems missing runbooks, sorted by criticality (servers first)',
                  '- Recommendations for which runbooks to create first.',
                ].join('\n'),
              },
            },
          ],
        };

      case 'password-audit':
        return {
          description: 'Find passwords not rotated in 90+ days',
          messages: [
            {
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: [
                  `Audit password rotation compliance for ${args?.org_name} in IT Glue.`,
                  'Identify any passwords that have not been rotated in 90 or more days.',
                  '',
                  'Use the available IT Glue tools to:',
                  '1. Search for the organization and get its ID,',
                  '2. Search for all password entries associated with the org,',
                  '3. For each password entry, check the last-updated date,',
                  '4. Flag passwords not updated in:',
                  '   - 90–180 days: overdue (should rotate soon)',
                  '   - 180–365 days: concerning (rotate immediately)',
                  '   - 365+ days: critical (escalate)',
                  '5. Identify any shared/admin credentials that are particularly sensitive',
                  '   (look for names containing: admin, root, service account, domain, firewall, etc.),',
                  '6. Note any passwords with no last-updated date recorded.',
                  '',
                  'Present as a password hygiene report:',
                  '- Summary counts by age bucket',
                  '- Critical and concerning passwords listed first with name and age',
                  '- Recommendations for immediate action.',
                  '',
                  'Do NOT display actual password values in the report.',
                ].join('\n'),
              },
            },
          ],
        };

      default:
        throw new Error(`Unknown prompt: ${name}`);
    }
  });
}
