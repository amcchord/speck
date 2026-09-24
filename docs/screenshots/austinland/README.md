# Network, DNS, keys and API access — September 23, 2026

Original WebKit captures from the synthetic fixtures in `web/test/ui/austinland.spec.mjs`;
no real domains, addresses or credentials. Digests are in [manifest.json](manifest.json).

- [Domains](domains-desktop.png) and [domain records pane](domain-pane-desktop.png)
- [Public IPs](public-ips-desktop.png) and [reachability](reachability-desktop.png)
- [Vault](vault-desktop.png), [revealed entry](vault-entry-desktop.png) and [provisioning](provision-desktop.png)
- [Providers with read-only checks](providers-desktop.png)
- [API & agents](api-desktop.png) and [one-time token display](token-created-desktop.png)
- Phone: [domains](domains-phone.png), [vault entry](vault-entry-phone.png), [API](api-phone.png)

The pages were also reviewed against real GoDaddy, UniFi, Linode and Proxmox data on
a local instance using read-only calls; those captures stay in ignored `output/`.
See [operations](../../operations/austinland-integration.md). Reproduce with
`npm run build --prefix web` and `npx playwright test test/ui/austinland.spec.mjs` in `web/`.
