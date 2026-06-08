from pathlib import Path
from typing import Iterable


def ensure_output_dir(path: str = "output") -> Path:
    output_dir = Path(path)
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir


def sanitize_filename(name: str) -> str:
    safe_chars = [c if c.isalnum() or c in ("-", "_", ".") else "_" for c in name]
    collapsed = "".join(safe_chars).strip("_")
    return collapsed or "generated_output"


def chunk_lines(lines: Iterable[str], size: int = 40) -> list[str]:
    chunk = []
    chunks = []
    for line in lines:
        chunk.append(line)
        if len(chunk) >= size:
            chunks.append("\n".join(chunk))
            chunk = []
    if chunk:
        chunks.append("\n".join(chunk))
    return chunks


def clear_directory(path: str, keep_names: set[str] | None = None) -> None:
    keep_names = keep_names or set()
    target_dir = Path(path)
    if not target_dir.exists():
        return

    for child in target_dir.iterdir():
        if child.name in keep_names:
            continue
        if child.is_dir():
            for nested in child.rglob("*"):
                if nested.is_file():
                    nested.unlink(missing_ok=True)
            for nested_dir in sorted([p for p in child.rglob("*") if p.is_dir()], reverse=True):
                nested_dir.rmdir()
            child.rmdir()
        else:
            child.unlink(missing_ok=True)
