// Pure helpers for the Keys page, kept free of DOM and CSS for unit tests.
const SECRET = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;

/** Parse .env text into {NAME: value}; ignores comments, `export` and surrounding quotes. */
export function parseDotenv(text: string) {
  const values: Record<string, string> = {};
  const invalid: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.replace(/^export\s+/, "").match(/^([^=]+)=(.*)$/);
    if (!match) {
      invalid.push(line.slice(0, 40));
      continue;
    }
    const key = match[1].trim();
    let value = match[2].trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    if (!SECRET.test(key)) invalid.push(key.slice(0, 40));
    else values[key] = value;
  }
  return { values, invalid };
}

/** .env lines matching the server's quoting rules. */
export function dotenv(values: Record<string, string>) {
  return Object.keys(values)
    .sort()
    .map((k) => {
      const v = values[k];
      return /^[A-Za-z0-9_./:@+-]*$/.test(v) ? `${k}=${v}` : `${k}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
    })
    .join("\n") + "\n";
}

/** Group entries by recorded project, else by the longest known project prefix of the name. */
export function groupEntries<T extends Record<string, any>>(entries: T[]) {
  const projects = [...new Set(entries.map((e) => e.project).filter(Boolean) as string[])].sort((a, b) => b.length - a.length);
  const groups = new Map<string, T[]>();
  for (const e of entries) {
    const key = e.project || projects.find((p) => e.name === p || e.name.startsWith(p + "-")) || "Other credentials";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  return [...groups.entries()].sort(([a], [b]) =>
    a === "Other credentials" ? 1 : b === "Other credentials" ? -1 : a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}

export function validSecretName(name: string) {
  return SECRET.test(name);
}
