# Fix Root README Provider Table

## Problem
The root README.md provider table only shows 6 of 12 provider categories. Missing: Auth, Access Control, Storage, Credential Vault, Coding Agent, Agent Tool.

## Context
- File: `README.md` (repo root)
- The provider table is in the "Provider Matrix" section
- Each row has: Category, Provider, Status columns

## Task
Add the missing provider categories to the table:

| Category | Provider | Status |
|----------|----------|--------|
| Auth | `noAuth()`, `apiKeyAuth()` | Shipped |
| Access Control | `allowAllGuard()`, `roleBasedGuard()` | Shipped |
| Storage | `fsStorage()`, `s3Storage()` | Shipped |
| Credential Vault | `envVault()` | Shipped |
| Coding Agent | `claudeCode()` | Shipped |
| Agent Tool | `agentTool()` | Shipped |

## Verification
- Read the current README.md to find the exact table format and location
- Add the missing rows matching the existing style
- Ensure no duplicates
