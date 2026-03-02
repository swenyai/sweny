import * as fs from "node:fs";
/**
 * Parse a service-map.yml file using simple line-based parsing.
 * Avoids YAML library dependency for ncc bundling simplicity.
 */
export function parseServiceMap(filePath, logger) {
    if (!fs.existsSync(filePath)) {
        logger?.warn(`Service map not found at ${filePath}`);
        return { services: [] };
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const services = [];
    let current = null;
    let inOwns = false;
    for (const line of lines) {
        const trimmed = line.trimEnd();
        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith("#"))
            continue;
        // Top-level "services:" header
        if (trimmed === "services:")
            continue;
        // Service name (2-space indent, ends with colon)
        const serviceMatch = trimmed.match(/^  (\S+):$/);
        if (serviceMatch) {
            if (current)
                services.push(current);
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
    if (current)
        services.push(current);
    return { services };
}
//# sourceMappingURL=service-map.js.map