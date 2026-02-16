import CryptoKit
import Foundation

/// URLSession delegate that pins the server's TLS certificate against a known SHA-256 fingerprint.
/// This allows the app to trust a specific self-signed certificate from the companion server.
final class CertificatePinningDelegate: NSObject, URLSessionDelegate, Sendable {
    /// Expected fingerprint as uppercase hex with colon separators (e.g. "AB:CD:EF:...").
    let pinnedFingerprint: String

    init(fingerprint: String) {
        // Normalize: uppercase, strip whitespace
        self.pinnedFingerprint = fingerprint
            .trimmingCharacters(in: .whitespaces)
            .uppercased()
        super.init()
    }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge
    ) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let serverTrust = challenge.protectionSpace.serverTrust
        else {
            return (.performDefaultHandling, nil)
        }

        // Extract the leaf (server) certificate
        guard let certificates = SecTrustCopyCertificateChain(serverTrust) as? [SecCertificate],
              let leafCert = certificates.first
        else {
            return (.cancelAuthenticationChallenge, nil)
        }

        // Get DER-encoded data and compute SHA-256 fingerprint
        let derData = SecCertificateCopyData(leafCert) as Data
        let hash = SHA256.hash(data: derData)
        let serverFingerprint = hash.map { String(format: "%02X", $0) }.joined(separator: ":")

        if serverFingerprint == pinnedFingerprint {
            let credential = URLCredential(trust: serverTrust)
            return (.useCredential, credential)
        } else {
            return (.cancelAuthenticationChallenge, nil)
        }
    }
}
