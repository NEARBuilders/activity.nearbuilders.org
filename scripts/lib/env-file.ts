// Line-oriented .env helpers. Deliberately do not reformat existing lines —
// first-run must never clobber a value an operator already wrote.

export function parseEnvKeys(content: string): Set<string> {
  const keys = new Set<string>();
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    keys.add(trimmed.slice(0, eq));
  }
  return keys;
}

export function getEnvValue(content: string, key: string): string | undefined {
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}=`)) {
      return trimmed.slice(key.length + 1);
    }
  }
  return undefined;
}

export function isEnvValueBlank(content: string, key: string): boolean {
  const value = getEnvValue(content, key);
  return value === undefined || value.trim() === "";
}

export function appendEnvLines(content: string, lines: string[]): string {
  if (lines.length === 0) return content;
  const suffix = content === "" || content.endsWith("\n") ? "" : "\n";
  return `${content}${suffix}${lines.join("\n")}\n`;
}

/**
 * Sets `key` to `value` only if it is absent or currently blank in `content`.
 * A non-blank existing value is left untouched — this is what lets first-run
 * be safe to re-run without clobbering real operator-provided secrets.
 */
export function setEnvValueIfBlank(
  content: string,
  key: string,
  value: string,
): { content: string; changed: boolean } {
  const lines = content.split("\n");
  let found = false;
  let changed = false;
  const nextLines = lines.map((line) => {
    if (line.trim().startsWith(`${key}=`)) {
      found = true;
      if (isEnvValueBlank(content, key)) {
        changed = true;
        return `${key}=${value}`;
      }
    }
    return line;
  });
  if (!found) {
    return { content: appendEnvLines(content, [`${key}=${value}`]), changed: true };
  }
  return { content: changed ? nextLines.join("\n") : content, changed };
}

/**
 * Appends only the keys from `defaults` that are absent from `content`.
 * Never touches a key that already exists, even if its value is blank —
 * that distinction (present-but-empty vs. absent) matters to callers like
 * the master-key generation step.
 */
export function mergeMissingEnvKeys(
  content: string,
  defaults: Record<string, string>,
): { content: string; added: string[] } {
  const existing = parseEnvKeys(content);
  const missing = Object.entries(defaults).filter(([key]) => !existing.has(key));
  if (missing.length === 0) return { content, added: [] };
  const content_ = appendEnvLines(
    content,
    missing.map(([key, value]) => `${key}=${value}`),
  );
  return { content: content_, added: missing.map(([key]) => key) };
}
