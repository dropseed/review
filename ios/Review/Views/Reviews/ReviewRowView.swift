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
                        .background(Circle().fill(Color(.systemBackground)).padding(-1))
                        .offset(x: 3, y: 3)
                }
            }

            VStack(spacing: 2) {
                // Top row: repo name + time
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

                // Bottom row: comparison + file stats
                HStack(spacing: 0) {
                    Text(comparisonLabel)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)

                    Spacer(minLength: 0)

                    if let stats = review.diffStats, stats.fileCount > 0 {
                        HStack(spacing: 2) {
                            Text("\(stats.fileCount) \(stats.fileCount == 1 ? "file" : "files")")
                                .foregroundStyle(.tertiary)
                            if stats.additions > 0 || stats.deletions > 0 {
                                Text("+\(stats.additions)")
                                    .foregroundStyle(.green)
                                Text("-\(stats.deletions)")
                                    .foregroundStyle(.red)
                            }
                        }
                        .monospacedDigit()
                    }
                }
                .font(.subheadline)
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
    let isoFormatter = ISO8601DateFormatter()
    isoFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

    guard let date = isoFormatter.date(from: dateString) ?? {
        isoFormatter.formatOptions = [.withInternetDateTime]
        return isoFormatter.date(from: dateString)
    }() else {
        return dateString
    }

    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .abbreviated
    return formatter.localizedString(for: date, relativeTo: Date())
}
