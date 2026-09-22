# Speck iOS privacy

Speck connects to the HTTPS server selected by its operator. That server processes
account identifiers, management commands, uploaded files, AI prompts and audit
activity to provide remote monitoring and management. Operators should use a
server they trust and follow their organization's device-management policies.

The app stores its session token in the device-only Keychain while signed in. It
never saves the password. Fleet data, screen previews and remote session data are
held in memory rather than an app database. Downloaded files are temporary until
the operator saves or shares them; temporary downloads are removed when leaving
the file browser. The operating system protects temporary files while locked.

AI drafting sends the submitted prompt to the OpenAI account configured on the
Speck server. It does not run a generated script automatically. Optional remote
microphone input asks for permission and starts only when enabled by the operator.
The app does not include advertising, analytics or tracking SDKs.

The server retains management history and audit records according to its operator's
configuration. For data access or deletion, contact that server's administrator.
Speck is open source: https://github.com/amcchord/speck. Report software issues there;
do not post credentials, private machine details or customer data in an issue.
