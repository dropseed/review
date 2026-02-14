import SwiftUI

struct ReviewRowView: View {
    let review: GlobalReviewSummary
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
        HStack(spacing: 10) {
            // Avatar with optional progress ring overlay
            ZStack(alignment: .bottomTrailing) {
                if let url = avatarURL {
                    AsyncImage(url: url) { image in
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    } placeholder: {
                        initialsView
                    }
                    .frame(width: 36, height: 36)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                } else {
                    initialsView
                }

                if progress > 0 {
                    ProgressCircle(progress: progress, size: 14, strokeWidth: 2)
                        .background(Circle().fill(.black).padding(-1))
                        .offset(x: 3, y: 3)
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                // Repo name + status badge
                HStack(spacing: 6) {
                    Text(review.repoName)
                        .font(.body.weight(.semibold))
                        .lineLimit(1)

                    if let state = review.state {
                        StatusBadge(state: state)
                    }

                    Spacer(minLength: 0)

                    Text(formatRelativeTime(review.updatedAt))
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }

                // Comparison + diff stats on one line
                HStack(spacing: 0) {
                    Text(comparisonLabel)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)

                    if let stats = review.diffStats, stats.additions > 0 || stats.deletions > 0 {
                        Text("  +\(stats.additions)")
                            .foregroundStyle(.green)
                        Text(" -\(stats.deletions)")
                            .foregroundStyle(.red)
                    }
                }
                .font(.subheadline)
                .monospacedDigit()
            }
        }
        .padding(.vertical, 4)
    }

    private var initialsView: some View {
        RoundedRectangle(cornerRadius: 8)
            .fill(.quaternary)
            .frame(width: 36, height: 36)
            .overlay {
                Text(String(review.repoName.prefix(2)).uppercased())
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
    }
}

// MARK: - Progress Circle

private struct ProgressCircle: View {
    let progress: Double
    var size: CGFloat = 20
    var strokeWidth: CGFloat = 2.5

    var body: some View {
        ZStack {
            Circle()
                .stroke(.tertiary.opacity(0.3), lineWidth: strokeWidth)

            Circle()
                .trim(from: 0, to: progress)
                .stroke(
                    progress >= 1.0 ? Color.orange : Color.statusApproved,
                    style: StrokeStyle(lineWidth: strokeWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
        }
        .frame(width: size, height: size)
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
