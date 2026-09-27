# Keys workspace

Synthetic fixtures from the real console, September 27, 2026. No customer data or
credential values are present. Desktop captures use Chromium; phone captures use
WebKit. Browser regression coverage also includes a 768px tablet.

- [Vault](vault-desktop.png): project/service/kind/usage filters, local metadata search and bounded rendering.
- [Providers](providers-desktop.png): configuration health, project coverage and on-demand checks.
- [Relationships](relationships-desktop.png): recorded system links and access history in the shared flyout.
- [Phone relationships](relationships-phone.png): responsive inspector and local inventory linking.
- [SSH identity](ssh-phone.png): fingerprint, lifecycle, explicit reveal and registration controls.

Access history observes reads through Speck, not use by external applications.
System links are recorded configuration; they do not prove a credential is still
installed or valid. VM creation records supplied SSH keys and saved administrator
credentials. Existing imported credentials can be associated with known systems
without revealing or installing a credential. Provider registration is checked
on demand so the SSH list never waits for Linode.
