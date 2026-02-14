import SwiftUI

struct NotesView: View {
    @Environment(ReviewStateManager.self) private var stateManager

    @State private var text: String = ""
    @State private var hasLoaded = false

    var body: some View {
        ScrollView {
            ZStack(alignment: .topLeading) {
                TextEditor(text: $text)
                    .scrollContentBackground(.hidden)
                    .font(.body)
                    .frame(minHeight: 200)
                    .padding(8)
                    .onChange(of: text) { _, newValue in
                        guard hasLoaded else { return }
                        stateManager.updateNotes(newValue)
                    }

                if text.isEmpty {
                    Text("Add review notes...")
                        .foregroundStyle(.tertiary)
                        .font(.body)
                        .padding(16)
                        .allowsHitTesting(false)
                }
            }
            .background(Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color(.systemGray4), lineWidth: 1)
            )
            .padding()
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
