#!/usr/bin/env bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

check_uv_installed() {
    if command -v uv &> /dev/null; then
        info "uv is already installed: $(uv --version)"
        return 0
    else
        return 1
    fi
}

install_uv() {
    info "Installing uv..."

    if ! command -v curl &> /dev/null; then
        error "curl is required to install uv. Please install curl first."
        exit 1
    fi

    if curl -LsSf https://astral.sh/uv/install.sh | sh; then
        success "uv installed successfully"
        export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"

        if ! command -v uv &> /dev/null; then
            warning "uv was installed but not found in PATH for this session"
            warning "Please restart your shell and run this installer again."
            exit 1
        fi
    else
        error "Failed to install uv"
        exit 1
    fi
}

install_human_review() {
    info "Installing human-review CLI..."
    uv tool install human-review

    info "Installing Claude skill..."
    git-review agent --install-skill
}

main() {
    echo ""
    echo "Starting human-review installation..."
    echo ""

    if ! check_uv_installed; then
        install_uv
    fi

    install_human_review

    if command -v git-review &> /dev/null; then
        success "Installation completed successfully!"
        echo ""
        echo "============================================"
        echo "Run 'git review agent' to launch Claude"
        echo "with the /human-review skill."
        echo ""
        echo "For auto-approval, add to ~/.claude/settings.json:"
        echo '  {"permissions": {"allow": ["Bash(git review:*)"]}}'
        echo "============================================"
    else
        warning "Installation completed but 'git-review' not found in PATH"
        warning "You may need to restart your shell or add ~/.local/bin to PATH"
    fi
}

main
