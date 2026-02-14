import SwiftUI

struct FeedbackButton: View {
    let count: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "text.bubble")
                    .font(.system(size: 20))
                    .frame(width: 48, height: 48)
                    .glassEffect(.regular.interactive())

                if count > 0 {
                    Text("\(count)")
                        .font(.caption2.bold())
                        .foregroundStyle(.white)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(.red, in: Circle())
                        .offset(x: 4, y: -4)
                }
            }
        }
        .shadow(color: .black.opacity(0.15), radius: 4, y: 2)
    }
}
