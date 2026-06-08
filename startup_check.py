from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


REQUIREMENTS_FILE = Path("requirements.txt")

# Package names from requirements may differ from import module names.
IMPORT_NAME_MAP = {
    "beautifulsoup4": "bs4",
    "flask": "flask",
    "openpyxl": "openpyxl",
    "pypdf": "pypdf",
    "python-docx": "docx",
    "requests": "requests",
}


def _parse_requirement_name(line: str) -> str:
    raw = line.strip()
    if not raw or raw.startswith("#"):
        return ""

    for token in ("==", ">=", "<=", "~=", "!=", ">", "<"):
        if token in raw:
            return raw.split(token, 1)[0].strip().lower()

    return raw.lower()


def _load_required_packages() -> list[str]:
    if not REQUIREMENTS_FILE.exists():
        return []

    packages: list[str] = []
    for line in REQUIREMENTS_FILE.read_text(encoding="utf-8").splitlines():
        name = _parse_requirement_name(line)
        if name:
            packages.append(name)
    return packages


def _missing_imports(packages: list[str]) -> list[tuple[str, str]]:
    missing: list[tuple[str, str]] = []
    for package in packages:
        import_name = IMPORT_NAME_MAP.get(package, package)
        if importlib.util.find_spec(import_name) is None:
            missing.append((package, import_name))
    return missing


def main() -> int:
    packages = _load_required_packages()
    if not packages:
        print("[startup-check] requirements.txt not found or empty.")
        return 1

    missing = _missing_imports(packages)
    if not missing:
        print("[startup-check] All required packages are available.")
        return 0

    print("[startup-check] Missing required packages detected:")
    for package, import_name in missing:
        print(f"  - {package} (import: {import_name})")

    py = sys.executable
    print("\n[startup-check] Fix command:")
    print(f'  "{py}" -m pip install -r requirements.txt')
    print("\n[startup-check] If your virtual environment is not active, activate it and rerun start.bat.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
