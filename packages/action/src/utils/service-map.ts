import * as fs from "fs";
import * as core from "@actions/core";

export interface ServiceEntry {
  name: string;
  repo: string;
  owns: string[];
}

export interface ServiceMap {
  services: ServiceEntry[];
}

/**
 * Parse a service-map.yml file using simple line-based parsing.
 * Avoids YAML library dependency for ncc bundling simplicity.
 */
export function parseServiceMap(filePath: string): ServiceMap {
  if (!fs.existsSync(filePath)) {
    core.warning(`Service map not found at ${filePath}`);
    return { services: [] };
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const services: ServiceEntry[] = [];
  let current: ServiceEntry | null = null;
  let inOwns = false;

  for (const line of lines) {
    const trimmed = line.trimEnd();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Top-level "services:" header
    if (trimmed === "services:") continue;

    // Service name (2-space indent, ends with colon)
    const serviceMatch = trimmed.match(/^  (\S+):$/);
    if (serviceMatch) {
      if (current) services.push(current);
      current = { name: serviceMatch[1], repo: "", owns: [] };
      inOwns = false;
      continue;
    }

    // repo field
    const repoMatch = trimmed.match(/^\s+repo:\s*"?([^"]+)"?$/);
    if (repoMatch && current) {
      current.repo = repoMatch[1];
      inOwns = false;
      continue;
    }

    // owns header
    if (trimmed.match(/^\s+owns:\s*$/) && current) {
      inOwns = true;
      continue;
    }

    // owns list item
    const ownsMatch = trimmed.match(/^\s+-\s+(.+)$/);
    if (ownsMatch && current && inOwns) {
      current.owns.push(ownsMatch[1].trim());
      continue;
    }
  }

  if (current) services.push(current);
  return { services };
}

/**
 * Find the target repo for a given Datadog service name.
 */
export function findRepoForService(
  serviceMap: ServiceMap,
  serviceName: string
): string | null {
  for (const entry of serviceMap.services) {
    if (entry.owns.includes(serviceName)) {
      return entry.repo;
    }
  }
  return null;
}
