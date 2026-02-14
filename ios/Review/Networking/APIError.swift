import Foundation

enum APIError: LocalizedError {
    case httpError(statusCode: Int, message: String)
    case networkError(Error)
    case decodingError(Error)
    case invalidURL
    case noData

    var errorDescription: String? {
        switch self {
        case .httpError(let statusCode, let message):
            return "HTTP \(statusCode): \(message)"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .decodingError(let error):
            return "Decoding error: \(error.localizedDescription)"
        case .invalidURL:
            return "Invalid URL"
        case .noData:
            return "No data received"
        }
    }
}
