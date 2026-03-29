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
export declare function parseServiceMap(filePath: string): ServiceMap;
/**
 * Find the target repo for a given Datadog service name.
 */
export declare function findRepoForService(serviceMap: ServiceMap, serviceName: string): string | null;
//# sourceMappingURL=service-map.d.ts.map