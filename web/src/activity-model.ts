// Readable names for audit event codes; the code itself stays available on hover.
const EXACT: Record<string, string> = {
  "session.login": "Signed in",
  "vault.reveal": "Vault entry revealed",
  "vault.reveal.env": "Vault entry exported as .env",
  "vault.provision.reused": "Existing project key returned",
  "vault.provisioned": "Project key provisioned",
  "dns.pointed": "DNS name pointed",
  "unifi.exposed": "Public IP mapped",
  "unifi.unexposed": "Public IP mapping removed",
  "context.read": "Handoff file opened",
  "ssh.private_revealed": "SSH private key revealed",
};
const WORDS: Record<string, string> = {
  api: "API", api_token: "API token", ai: "AI", dns: "DNS", ssh: "SSH key", unifi: "Public IP", vault: "Vault",
  infrastructure: "Infrastructure", totp: "Authenticator", passkey: "Passkey", rdp: "RDP", vm: "VM", id: "ID",
};

export function eventLabel(code: string) {
  if (EXACT[code]) return EXACT[code];
  const words = code
    .split(".")
    .flatMap((part, i) => (i === 0 && WORDS[part] ? [WORDS[part]] : part.split("_").map((w) => WORDS[w] || w)));
  const text = words.join(" ").replace(/\s+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : code;
}
