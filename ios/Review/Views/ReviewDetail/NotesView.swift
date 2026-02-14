import SwiftUI

struct NotesView: View {
    @Environment(ReviewStateManager.self) private var stateManager

    @State private var text: String = ""
    @State private var hasLoaded = false

    var body: some View {
        ZStack(alignment: .topLeading) {
            TextEditor(text: $text)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 4)
                .onChange(of: text) { _, newValue in
                    guard hasLoaded else { return }
                    stateManager.updateNotes(newValue)
                }

            if text.isEmpty {
                Text("Add review notes...")
                    .foregroundStyle(.tertiary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 12)
                    .allowsHitTesting(false)
            }
        }
        .onAppear {
            text = stateManager.reviewState?.notes ?? ""
            hasLoaded = true
        }
        .onChange(of: stateManager.reviewState?.notes) { _, newValue in
            if let newValue, newValue != text {
                text = newValue
            }
        }
    }
}
