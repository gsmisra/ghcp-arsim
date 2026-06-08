from __future__ import annotations

import argparse
import sys
from pathlib import Path

CORE_LOGIC_PATH = Path(__file__).resolve().parent / "core-logic"
if str(CORE_LOGIC_PATH) not in sys.path:
    sys.path.insert(0, str(CORE_LOGIC_PATH))

from config_loader import Config  # noqa: E402
from qe_service import QEAgenticPlatformService  # noqa: E402
from utils.logging_config import configure_logging  # noqa: E402


def prompt_source() -> str:
    print("Source of requirement ?")
    print("a. Document")
    print("b. Confluence")
    print("c. Jira / Jtmf")
    source = input("Enter a, b, or c: ").strip().lower()
    while source not in {"a", "b", "c"}:
        source = input("Invalid input. Enter a, b, or c: ").strip().lower()
    return source


def prompt_document_format() -> str:
    print("Choose document type:")
    print("1. docx")
    print("2. xlsx")
    print("3. pdf")
    print("4. csv")
    mapping = {"1": "docx", "2": "xlsx", "3": "pdf", "4": "csv"}
    choice = input("Enter 1, 2, 3, or 4: ").strip()
    while choice not in mapping:
        choice = input("Invalid input. Enter 1, 2, 3, or 4: ").strip()
    return mapping[choice]


def prompt_output_format() -> str:
    print("Generate test cases as:")
    print("1. Jira CSV format")
    print("2. BDD feature format")
    mapping = {"1": "jira_csv", "2": "bdd"}
    choice = input("Enter 1 or 2: ").strip()
    while choice not in mapping:
        choice = input("Invalid input. Enter 1 or 2: ").strip()
    return mapping[choice]


def run_interactive(service: QEAgenticPlatformService) -> None:
    source = prompt_source()
    output_format = prompt_output_format()

    if source == "a":
        expected_type = prompt_document_format()
        file_path = input("Enter full file path: ").strip().strip('"')
        if not Path(file_path).exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        actual_type = Path(file_path).suffix.lower().replace(".", "")
        if actual_type != expected_type:
            raise ValueError(f"Selected type '{expected_type}' does not match file extension '{actual_type}'")
        outputs = service.process_document(file_path, output_format)

    elif source == "b":
        page_input = input("Enter Confluence URL or page ID: ").strip()
        outputs = service.process_confluence(page_input, output_format)

    else:
        story_ids_raw = input("Enter Story ID or comma-separated Story IDs: ").strip()
        story_ids = [x.strip() for x in story_ids_raw.split(",") if x.strip()]
        if not story_ids:
            raise ValueError("At least one Story ID is required")
        outputs = service.process_jira(story_ids, output_format)

    print("Generated outputs:")
    for output in outputs:
        print(f"- {output}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="QE Agentic Platform")
    parser.add_argument("--interactive", action="store_true", help="Run interactive CLI flow")
    parser.add_argument("--source", choices=["document", "confluence", "jira"], help="Source type")
    parser.add_argument("--input", help="Input path/url or comma-separated story IDs")
    parser.add_argument("--output-format", choices=["bdd", "jira_csv"], default="bdd")
    return parser


def run_non_interactive(service: QEAgenticPlatformService, args: argparse.Namespace) -> None:
    if not args.source or not args.input:
        raise ValueError("--source and --input are required in non-interactive mode")

    if args.source == "document":
        outputs = service.process_document(args.input, args.output_format)
    elif args.source == "confluence":
        outputs = service.process_confluence(args.input, args.output_format)
    else:
        story_ids = [x.strip() for x in args.input.split(",") if x.strip()]
        outputs = service.process_jira(story_ids, args.output_format)

    print("Generated outputs:")
    for output in outputs:
        print(f"- {output}")


def main() -> None:
    config = Config("app_config.properties")
    configure_logging(config.get("APP_LOG_FILE", "output/platform.log"))
    parser = build_parser()
    args = parser.parse_args()

    service = QEAgenticPlatformService(config.get("APP_CONFIG_FILE", "app_config.properties"))
    if args.interactive or (not args.source and not args.input):
        run_interactive(service)
    else:
        run_non_interactive(service, args)


if __name__ == "__main__":
    main()
