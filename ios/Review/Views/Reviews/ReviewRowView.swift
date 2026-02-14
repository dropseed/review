import SwiftUI

struct ReviewRowView: View {
    let review: GlobalReviewSummary
    let diffStats: DiffShortStat?
    let avatarURL: URL?

    private var progress: Double {
        review.totalHunks > 0 ? Double(review.reviewedHunks) / Double(review.totalHunks) : 0
    }

    private var comparisonLabel: String {
        if let pr = review.githubPr {
            return "PR #\(pr.number): \(pr.title)"
        }
        return "\(review.comparison.base)..\(review.comparison.head)"
    }

    var body: some View {
        HStack(spacing: 12) {
            // Avatar
            if let url = avatarURL {
                AsyncImage(url: url) { image in
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } placeholder: {
                    initialsView
                }
                .frame(width: 36, height: 36)
                .clipShape(Circle())
            } else {
                initialsView
            }

            // Main content
            VStack(alignment: .leading, spacing: 2) {
                // Repo name + status badge
                HStack(spacing: 8) {
                    Text(review.repoName)
                        .font(.body.weight(.semibold))
                        .lineLimit(1)

                    if let state = review.state {
                        StatusBadge(state: state)
                    }
                }

                // Comparison label
                Text(comparisonLabel)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                // Meta line
                HStack(spacing: 0) {
                    if let stats = diffStats {
                        Text("\(stats.fileCount) file\(stats.fileCount != 1 ? "s" : "")")
                            .foregroundStyle(.secondary)

                        Text(" +\(stats.additions)")
                            .foregroundStyle(.green)
                            .fontWeight(.medium)

                        Text(" -\(stats.deletions)")
                            .foregroundStyle(.red)
                            .fontWeight(.medium)

                        Text(" \u{00B7} ")
                            .foregroundStyle(.tertiary)
                    }

                    Text("\(review.reviewedHunks)/\(review.totalHunks) reviewed")
                        .foregroundStyle(.secondary)

                    Text(" \u{00B7} ")
                        .foregroundStyle(.tertiary)

                    Text(formatRelativeTime(review.updatedAt))
                        .foregroundStyle(.secondary)
                }
                .font(.caption)
                .monospacedDigit()

                // Progress bar
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(.tertiary.opacity(0.3))
                            .frame(height: 3)

                        Capsule()
                            .fill(Color.statusApproved)
                            .frame(width: geometry.size.width * progress, height: 3)
                    }
                }
                .frame(height: 3)
                .padding(.top, 4)
            }
        }
        .padding(.vertical, 4)
    }

    private var initialsView: some View {
        Circle()
            .fill(.quaternary)
            .frame(width: 36, height: 36)
            .overlay {
                Text(String(review.repoName.prefix(2)).uppercased())
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
    }
}

// MARK: - Status Badge

private struct StatusBadge: View {
    let state: GlobalReviewSummary.ReviewOverallState

    private var isApproved: Bool {
        state == .approved
    }

    var body: some View {
        Text(isApproved ? "Approved" : "Changes")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(isApproved ? .green : .red)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
                (isApproved ? Color.green : Color.red).opacity(0.15),
                in: Capsule()
            )
    }
}

// MARK: - Relative Time Formatting

func formatRelativeTime(_ dateString: String) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

    // Try with fractional seconds first, then without
    guard let date = formatter.date(from: dateString) ?? {
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: dateString)
    }() else {
        return dateString
    }

    let now = Date()
    let diff = now.timeIntervalSince(date)

    if diff < 60 {
        return "just now"
    }

    let minutes = Int(diff / 60)
    if minutes < 60 {
        return "\(minutes)m ago"
    }

    let hours = Int(diff / 3600)
    if hours < 24 {
        return "\(hours)h ago"
    }

    let days = Int(diff / 86400)
    if days < 30 {
        return "\(days)d ago"
    }

    return date.formatted(date: .abbreviated, time: .omitted)
}
