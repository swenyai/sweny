import type { Logger } from "@swenyai/providers";
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
export declare function parseServiceMap(filePath: string, logger?: Logger): ServiceMap;
//# sourceMappingURL=service-map.d.ts.map