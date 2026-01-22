"""Claude skill installation for human-review."""

import shutil
from pathlib import Path

# Directory containing skill templates
SKILLS_DIR = Path(__file__).parent / "skills"


def install_skill() -> Path:
    """Install the skill to global ~/.claude/skills/ directory.

    Creates a symlink from ~/.claude/skills/human-review to the source
    directory so updates are automatically reflected.

    Returns the path to the created skill symlink.
    """
    source_dir = SKILLS_DIR / "human-review"
    dest_dir = Path.home() / ".claude" / "skills" / "human-review"

    # Ensure parent directory exists
    dest_dir.parent.mkdir(parents=True, exist_ok=True)

    # Remove existing (file, directory, or symlink)
    if dest_dir.is_symlink() or dest_dir.exists():
        if dest_dir.is_dir() and not dest_dir.is_symlink():
            shutil.rmtree(dest_dir)
        else:
            dest_dir.unlink()

    # Create symlink
    dest_dir.symlink_to(source_dir)

    return dest_dir
