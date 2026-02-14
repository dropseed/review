import SwiftUI

struct GroupRowView: View {
    let group: HunkGroup
    let reviewState: ReviewState?

    private var reviewedCount: Int {
        guard let reviewState else { return 0 }
        return group.hunkIds.filter { hunkId in
            let status = getHunkReviewStatus(reviewState.hunks[hunkId], trustList: reviewState.trustList)
            return status != .pending
        }.count
    }

    private var totalCount: Int {
        group.hunkIds.count
    }

    private var allReviewed: Bool {
        totalCount > 0 && reviewedCount == totalCount
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(group.title)
                    .font(.subheadline.weight(.medium))

                Spacer()

                if allReviewed {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .font(.subheadline)
                } else {
                    Text("\(reviewedCount)/\(totalCount)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }

            Text(group.description)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            if let phase = group.phase {
                Text(phase)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(.purple)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.purple.opacity(0.12), in: Capsule())
            }
        }
        .padding(.vertical, 2)
    }
}
