import AuthenticationServices
import Foundation
import UIKit

extension Data {
  init?(base64URL: String) {
    let value = base64URL.replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    self.init(base64Encoded: value + String(repeating: "=", count: (4 - value.count % 4) % 4))
  }
  var base64URL: String {
    base64EncodedString().replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }
}

@MainActor final class PasskeyAuthorization: NSObject, ASAuthorizationControllerDelegate,
  ASAuthorizationControllerPresentationContextProviding
{
  private var continuation: CheckedContinuation<JSON, Error>?
  private var controller: ASAuthorizationController?
  private var anchor: ASPresentationAnchor?

  static func authorize(_ options: JSON, register: Bool = false) async throws -> JSON {
    let operation = PasskeyAuthorization()
    return try await operation.run(options, register: register)
  }

  private func run(_ options: JSON, register: Bool) async throws -> JSON {
    let rp = register ? options["rp"]["id"].string : options["rpId"].string
    // The shipped app is associated with Speck's domain. Self-hosted builds can
    // supply their own signed entitlements; never authorize an arbitrary RP.
    let domains = Bundle.main.object(forInfoDictionaryKey: "SpeckPasskeyDomains") as? [String] ?? []
    guard domains.contains(rp), let challenge = Data(base64URL: options["challenge"].string), !challenge.isEmpty else {
      throw SpeckError(message: "Passkeys are not configured for this server in this app. Use your password or the server’s web console.")
    }
    guard let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
      .filter({ $0.activationState == .foregroundActive }).flatMap(\.windows).first(where: \.isKeyWindow)
    else { throw SpeckError(message: "Open Speck to use your passkey.") }
    anchor = window
    let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rp)
    let request: ASAuthorizationRequest
    if register {
      guard let userID = Data(base64URL: options["user"]["id"].string), !userID.isEmpty else {
        throw SpeckError(message: "Invalid passkey account from the server.")
      }
      let creation = provider.createCredentialRegistrationRequest(
        challenge: challenge, name: options["user"]["name"].string, userID: userID)
      creation.userVerificationPreference = .required
      creation.excludedCredentials = options["excludeCredentials"].array.compactMap {
        Data(base64URL: $0["id"].string).map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }
      }
      request = creation
    } else {
      let assertion = provider.createCredentialAssertionRequest(challenge: challenge)
      assertion.userVerificationPreference = .required
      request = assertion
    }
    let controller = ASAuthorizationController(authorizationRequests: [request])
    controller.delegate = self
    controller.presentationContextProvider = self
    self.controller = controller
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        self.continuation = continuation
        if Task.isCancelled { finish(.failure(CancellationError())) }
        else { controller.performRequests() }
      }
    } onCancel: {
      Task { @MainActor [weak self] in
        self?.controller?.cancel()
        self?.finish(.failure(CancellationError()))
      }
    }
  }
  private func finish(_ result: Result<JSON, Error>) {
    let pending = continuation
    continuation = nil
    controller = nil
    anchor = nil
    pending?.resume(with: result)
  }
  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    anchor ?? ASPresentationAnchor()
  }
  func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
    var credentialID: Data
    var response: [String: JSON]
    if let key = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
       let attestation = key.rawAttestationObject {
      credentialID = key.credentialID
      response = ["clientDataJSON": .string(key.rawClientDataJSON.base64URL),
                  "attestationObject": .string(attestation.base64URL),
                  "transports": .array([.string("internal"), .string("hybrid")])]
    } else if let key = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion {
      credentialID = key.credentialID
      response = ["clientDataJSON": .string(key.rawClientDataJSON.base64URL),
                  "authenticatorData": .string(key.rawAuthenticatorData.base64URL),
                  "signature": .string(key.signature.base64URL), "userHandle": .string(key.userID.base64URL)]
    } else {
      finish(.failure(SpeckError(message: "The device returned an unsupported credential.")))
      return
    }
    finish(.success(.object(["id": .string(credentialID.base64URL), "rawId": .string(credentialID.base64URL),
                            "type": .string("public-key"), "response": .object(response)])))
  }
  func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
    if (error as? ASAuthorizationError)?.code == .canceled {
      finish(.failure(SpeckError(message: "Passkey request canceled. Try again or use your password.")))
    } else {
      finish(.failure(SpeckError(message: "Your device could not use this passkey. Try again, check your Passwords settings, or use your password.")))
    }
  }
}
