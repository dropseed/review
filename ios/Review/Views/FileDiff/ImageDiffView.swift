import SwiftUI

struct ImageDiffView: View {
    let imageDataUrl: String?
    let oldImageDataUrl: String?
    let filePath: String

    @State private var mode: DiffMode = .sideBySide
    @State private var overlayOpacity: Double = 0.5
    @State private var zoom: CGFloat = 1.0

    private var hasOldImage: Bool { oldImageDataUrl != nil }
    private var hasNewImage: Bool { imageDataUrl != nil }
    private var hasChanges: Bool { hasOldImage && hasNewImage }

    enum DiffMode: String, CaseIterable {
        case new = "New"
        case sideBySide = "Side by Side"
        case overlay = "Overlay"
    }

    var body: some View {
        VStack(spacing: 0) {
            if hasChanges {
                modePicker
            }

            ScrollView([.horizontal, .vertical]) {
                switch mode {
                case .new:
                    newImageView
                case .sideBySide:
                    if hasChanges {
                        sideBySideView
                    } else {
                        newImageView
                    }
                case .overlay:
                    if hasChanges {
                        overlayView
                    } else {
                        newImageView
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            zoomControls
        }
    }

    // MARK: - Mode Picker

    private var modePicker: some View {
        Picker("Mode", selection: $mode) {
            ForEach(DiffMode.allCases, id: \.self) { m in
                Text(m.rawValue).tag(m)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    // MARK: - New Image

    private var newImageView: some View {
        VStack(spacing: 12) {
            if let imageDataUrl, let image = decodeDataURL(imageDataUrl) {
                imageCard(uiImage: image, label: hasOldImage ? "New" : nil)
            } else if let oldImageDataUrl, let image = decodeDataURL(oldImageDataUrl) {
                imageCard(uiImage: image, label: "Deleted")
            } else {
                ContentUnavailableView("No Image", systemImage: "photo", description: Text("Could not load image"))
            }
        }
        .padding(16)
    }

    // MARK: - Side by Side

    private var sideBySideView: some View {
        VStack(spacing: 16) {
            if let oldImageDataUrl, let oldImage = decodeDataURL(oldImageDataUrl) {
                imageCard(uiImage: oldImage, label: "Before")
            }
            if let imageDataUrl, let newImage = decodeDataURL(imageDataUrl) {
                imageCard(uiImage: newImage, label: "After")
            }
        }
        .padding(16)
    }

    // MARK: - Overlay

    private var overlayView: some View {
        VStack(spacing: 12) {
            ZStack {
                if let oldImageDataUrl, let oldImage = decodeDataURL(oldImageDataUrl) {
                    Image(uiImage: oldImage)
                        .resizable()
                        .scaledToFit()
                        .scaleEffect(zoom)
                }
                if let imageDataUrl, let newImage = decodeDataURL(imageDataUrl) {
                    Image(uiImage: newImage)
                        .resizable()
                        .scaledToFit()
                        .scaleEffect(zoom)
                        .opacity(overlayOpacity)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .strokeBorder(Color.secondary.opacity(0.3), lineWidth: 1)
            )

            VStack(spacing: 4) {
                Text("Opacity: \(Int(overlayOpacity * 100))%")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Slider(value: $overlayOpacity, in: 0...1)
            }
            .padding(.horizontal, 16)
        }
        .padding(16)
    }

    // MARK: - Zoom

    private var zoomControls: some View {
        HStack(spacing: 16) {
            Button { zoom = max(0.25, zoom - 0.25) } label: {
                Image(systemName: "minus.magnifyingglass")
            }

            Text("\(Int(zoom * 100))%")
                .font(.caption.monospacedDigit())
                .frame(width: 44)

            Button { zoom = min(4.0, zoom + 0.25) } label: {
                Image(systemName: "plus.magnifyingglass")
            }

            Button { zoom = 1.0 } label: {
                Text("Fit")
                    .font(.caption)
            }
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial)
    }

    // MARK: - Helpers

    private func imageCard(uiImage: UIImage, label: String?) -> some View {
        VStack(spacing: 6) {
            if let label {
                Text(label)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Image(uiImage: uiImage)
                .resizable()
                .scaledToFit()
                .scaleEffect(zoom)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(Color.secondary.opacity(0.3), lineWidth: 1)
                )

            Text("\(Int(uiImage.size.width))x\(Int(uiImage.size.height))")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
    }

    private func decodeDataURL(_ dataURL: String) -> UIImage? {
        // Format: data:image/png;base64,iVBORw0KGgo...
        guard let commaIndex = dataURL.firstIndex(of: ",") else { return nil }
        let base64String = String(dataURL[dataURL.index(after: commaIndex)...])
        guard let data = Data(base64Encoded: base64String) else { return nil }
        return UIImage(data: data)
    }
}
