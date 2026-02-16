import SwiftUI
import VisionKit

struct PairingData: Codable {
    let url: String
    let token: String
    let fingerprint: String
}

struct QRScannerView: UIViewControllerRepresentable {
    let onScan: (PairingData) -> Void
    @Environment(\.dismiss) private var dismiss

    static var isAvailable: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ uiViewController: DataScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onScan: onScan, dismiss: dismiss)
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate, @unchecked Sendable {
        let onScan: (PairingData) -> Void
        let dismiss: DismissAction
        private var didScan = false

        init(onScan: @escaping (PairingData) -> Void, dismiss: DismissAction) {
            self.onScan = onScan
            self.dismiss = dismiss
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard !didScan else { return }

            for item in addedItems {
                guard case .barcode(let barcode) = item,
                      let payload = barcode.payloadStringValue,
                      let data = payload.data(using: .utf8),
                      let pairing = try? JSONDecoder().decode(PairingData.self, from: data)
                else { continue }

                didScan = true
                dataScanner.stopScanning()
                onScan(pairing)
                dismiss()
                return
            }
        }
    }
}
