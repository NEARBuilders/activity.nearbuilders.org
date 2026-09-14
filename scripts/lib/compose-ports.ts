export interface PortBinding {
  service: string;
  hostPort: number;
}

/** Compose "short syntax" ports are strings; "long syntax" ports are objects with `published`. */
function parsePortEntry(port: unknown): number | undefined {
  if (typeof port === "string") {
    const withoutProtocol = port.split("/")[0] ?? port;
    const parts = withoutProtocol.split(":");
    if (parts.length < 2) return undefined; // e.g. "6379" — container-only, no host bind
    const hostPort = Number(parts[parts.length - 2]);
    return Number.isFinite(hostPort) ? hostPort : undefined;
  }
  if (port && typeof port === "object") {
    const published = (port as Record<string, unknown>).published;
    if (published === undefined) return undefined;
    const hostPort = Number(published);
    return Number.isFinite(hostPort) ? hostPort : undefined;
  }
  return undefined; // bare numeric container-port shorthand — no host bind
}

export function extractHostPorts(serviceName: string, ports: unknown): PortBinding[] {
  if (!Array.isArray(ports)) return [];
  const bindings: PortBinding[] = [];
  for (const port of ports) {
    const hostPort = parsePortEntry(port);
    if (hostPort !== undefined) bindings.push({ service: serviceName, hostPort });
  }
  return bindings;
}
