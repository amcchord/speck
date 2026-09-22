# Passkeys

Speck supports discoverable WebAuthn passkeys for operator sign-in. Enroll under
**Settings → Account & access → Add passkey**, or **Account → Passkeys** in the
iPhone/iPad app. Give each key a recognizable name. Enrollment requires your
current password and, when enabled, a fresh authenticator or recovery code.

Choose **Sign in with a passkey** next time. A passkey requires user verification
by the authenticator (biometric or device/security-key PIN). It satisfies sign-in
without asking for the password or a separate TOTP code. Password plus any enabled
TOTP remains available. Speck does not store private keys or biometric information.

Rename or remove keys from the same account screen. Removing a key revokes sessions
created with it and closes that account's remote sessions. Administrators can
remove all keys through Manage account for a lost-device recovery. Password resets
do not silently remove passkeys; select the explicit passkey-reset option when
responding to a compromised account. Keep at least one trusted recovery route.

## Apps and platforms

- **Web:** modern WebAuthn browsers over HTTPS; synced passkeys and supported
  hardware keys. Cross-device availability is controlled by your browser/provider.
- **Speck Desktop 0.2.2:** the shared sign-in and account UI; native Windows WebAuthn;
  a signed, device-bound Touch ID keychain group on supported Macs. Mac Touch ID
  credentials in Electron do not sync to iCloud. Use **Use a passkey from your
  browser** for a browser/password-manager key on Windows, Mac or Linux. Check
  the six-character code in both windows, approve using your passkey, then return
  to Desktop. The desktop keeps its random verifier in memory; the browser never
  receives that verifier or the resulting desktop session cookie. The approval is
  single use, expires after two minutes, and leaves the browser's account alone.
- **iPhone/iPad 0.1.1 (4):** native AuthenticationServices registration/sign-in and
  passkey management. The distributed app is associated with `speckrmm.com`.
  Self-hosted deployments use browser passkeys or build the native app with their
  own associated domain and signing identity. Password login remains supported.
- **Windows/Linux endpoint agents and deployment tools:** retain unattended
  installation credentials and job leases. Passkeys authenticate humans, and do
  not replace service identities, enrollment tokens or Slide provider credentials.
  Existing recovery, scripting, remote control and file tools inherit the signed-in
  operator's existing role without a second identity system.

## Server and self-hosting

Set `SPECK_ORIGIN` to the exact public HTTPS origin. The hostname is the WebAuthn
relying-party ID; the origin is checked exactly. Changing the hostname requires new
passkey enrollment. `http://localhost` is supported for development only.

Install the locked dependencies from `deploy/requirements.txt`. Startup creates
additive `passkeys`, `passkey_challenges`, and `desktop_signins` tables and adds a
nullable passkey reference to sessions. Back up the database, encryption key,
server code and Python environment together before upgrading. A code-only rollback
to the previous release is unsafe because its positional session INSERT expects
four columns; use the matching backup before accepting new production writes.

Native Apple builds need the `webcredentials:<hostname>` associated-domain
entitlement, the same hostname in `SpeckPasskeyDomains`, and an HTTPS JSON response
at `/.well-known/apple-app-site-association`. Set `SPECK_APPLE_APP_IDS` to a
comma-separated list of authorized `TEAM_ID.bundle.identifier` values for your
own builds. The official app ID is returned by default only on the official
`https://speckrmm.com` origin. Apple caches associations; new entitlements require
an updated provisioning profile and app build.

## Signed desktop releases

Mac Touch ID requires an Apple Developer ID provisioning profile authorizing the
application identifier and keychain group, embedded in `Contents/embedded.provisionprofile`.
Notarization by itself does not satisfy this runtime requirement. The after-sign
release hook rejects signed Mac packages that omit the profile. Build with:

```sh
npm --prefix desktop run build -- --mac --config.mac.provisioningProfile=/absolute/path/SpeckDesktop.provisionprofile
```

The official profile, certificate keys and notarization credentials remain outside
source control. Community builds must replace the team and application identifiers
with their own signing identity. CI deliberately builds unsigned artifacts; only
the separately signed, profiled, notarized and launch-tested Mac packages are
published. Verify both app architectures, staple the app and DMG, and create ZIPs
from the stapled app before computing release checksums.

## Security and verification

Registration and authentication require user presence and verification, exact
challenge/origin/RP, valid signatures, matching user handles and active accounts.
Challenges are purpose-bound, expire after two minutes, and are consumed even on
failure. Registration is also bound to the original authenticated session and
account credential state. Counter validation uses the WebAuthn library, including
zero-counter synced credentials. Credential IDs are unique and canonical.
Authentication attempts are rate limited, and enrollment is limited to 20 keys per
account. Only public credential material is stored. Audit events contain method,
key record ID and operator label, without assertions or public/private key bytes.

The test suite generates COSE public keys and real ECDSA-signed authenticator
responses. It tests replay/races, expiry, wrong origin/RP/signature/user handle,
missing verification, account disable/revocation, session binding, TOTP proof,
role enforcement, desktop verifier binding and native late-ceremony cancellation.
Physical biometric/security-key acceptance is separate from these protocol tests;
no personal passkey is provisioned automatically for the operator.

Implementation references: [WebAuthn server library](https://duo-labs.github.io/py_webauthn/),
[Apple passkeys](https://developer.apple.com/documentation/authenticationservices/supporting-passkeys),
[Electron platform WebAuthn](https://www.electronjs.org/docs/latest/api/app#appconfigurewebauthnoptions-macos).
