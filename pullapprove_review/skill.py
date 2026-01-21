"""Claude skill installation for pullapprove-review."""

import shutil
from pathlib import Path

# Directory containing skill templates
SKILLS_DIR = Path(__file__).parent / "skills"


def install_skill() -> Path:
    """Install the skill to global ~/.claude/skills/ directory.

    Copies the pullapprove-review skill directory to ~/.claude/skills/.

    Returns the path to the created skill directory.
    """
    source_dir = SKILLS_DIR / "pullapprove-review"
    dest_dir = Path.home() / ".claude" / "skills" / "pullapprove-review"

    # Remove existing and copy fresh
    if dest_dir.exists():
        shutil.rmtree(dest_dir)

    shutil.copytree(source_dir, dest_dir)

    return dest_dir
