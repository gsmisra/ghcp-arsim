from __future__ import annotations

import sys
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file

CORE_LOGIC_PATH = Path(__file__).resolve().parent / "core-logic"
if str(CORE_LOGIC_PATH) not in sys.path:
    sys.path.insert(0, str(CORE_LOGIC_PATH))

from config_loader import Config  # noqa: E402
from qe_service import QEAgenticPlatformService  # noqa: E402
from utils.io_utils import clear_directory  # noqa: E402
from utils.logging_config import configure_logging  # noqa: E402

app = Flask(__name__, template_folder="ui", static_folder="ui", static_url_path="")
config = Config("app_config.properties")
service = QEAgenticPlatformService(config.get("APP_CONFIG_FILE", "app_config.properties"))
OUTPUT_DIR = Path(config.get("APP_OUTPUT_DIR", "output")).resolve()
TEMP_UPLOAD_DIR = Path(config.get("APP_TEMP_UPLOAD_DIR", "temp_uploads"))
ARCHITECTURE_DIR = Path("architecture").resolve()
SKILLS_DIR = Path("skills")
INSTRUCTIONS_DIR = Path("instructions")

SKILL_REQUIRED_FIELDS = ("file_name", "title", "purpose")
INSTRUCTION_REQUIRED_FIELDS = ("file_name", "title", "objective", "steps")


def _list_markdown_files(directory: Path) -> list[str]:
    if not directory.exists():
        return []
    return sorted([item.name for item in directory.iterdir() if item.is_file() and item.suffix.lower() == ".md"])


def _safe_target_file(directory: Path, file_name: str) -> Path:
    clean_name = (file_name or "").strip()
    if not clean_name:
        raise ValueError("File name is required")

    # If users provide a bare name (e.g. "arsenal"), save it as markdown.
    if not Path(clean_name).suffix:
        clean_name = f"{clean_name}.md"
    elif Path(clean_name).suffix.lower() != ".md":
        raise ValueError("Only .md files are allowed")

    target = (directory / clean_name).resolve()
    if directory.resolve() not in target.parents:
        raise ValueError("Invalid file name")
    return target


def _resolve_output_file(file_name: str) -> Path:
    if not file_name:
        raise ValueError("Missing file name")

    candidate = (OUTPUT_DIR / file_name).resolve()
    if OUTPUT_DIR not in candidate.parents and candidate != OUTPUT_DIR:
        raise ValueError("Invalid file path")
    if not candidate.exists() or not candidate.is_file():
        raise FileNotFoundError("File not found")
    return candidate


def _normalize_multiline_field(value: object) -> str:
    return str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()


def _validate_required_fields(payload: dict, required_fields: tuple[str, ...]) -> list[str]:
    missing = []
    for field in required_fields:
        if not _normalize_multiline_field(payload.get(field, "")):
            missing.append(field)
    return missing


def _append_markdown_section(lines: list[str], heading: str, value: str, required: bool = False) -> None:
    def _as_bullets(raw: str) -> list[str]:
        bullet_lines: list[str] = []
        for item in raw.split("\n"):
            clean = item.strip()
            if not clean:
                continue
            bullet_lines.append(clean if clean.startswith("- ") else f"- {clean}")
        return bullet_lines

    lines.append(f"## {heading}")
    if value:
        lines.extend(_as_bullets(value))
    elif required:
        lines.append("_Required value was not provided._")
    else:
        lines.append("_Not provided._")
    lines.append("")


def _build_skill_markdown(target_name: str, payload: dict) -> str:
    title = _normalize_multiline_field(payload.get("title", ""))
    lines = [f"# {title}", ""]

    _append_markdown_section(lines, "Purpose", _normalize_multiline_field(payload.get("purpose", "")), required=True)
    _append_markdown_section(lines, "Scope", _normalize_multiline_field(payload.get("scope", "")))
    _append_markdown_section(lines, "Business Context", _normalize_multiline_field(payload.get("business_context", "")))
    _append_markdown_section(lines, "Inputs", _normalize_multiline_field(payload.get("inputs", "")))
    _append_markdown_section(lines, "Preconditions", _normalize_multiline_field(payload.get("preconditions", "")))
    _append_markdown_section(lines, "Actions", _normalize_multiline_field(payload.get("actions", "")))
    _append_markdown_section(lines, "Rules and Validations", _normalize_multiline_field(payload.get("rules", "")))
    _append_markdown_section(lines, "Outputs", _normalize_multiline_field(payload.get("outputs", "")))
    _append_markdown_section(lines, "Dependencies", _normalize_multiline_field(payload.get("dependencies", "")))
    _append_markdown_section(lines, "Limitations", _normalize_multiline_field(payload.get("limitations", "")))

    lines.extend([
        "## Ownership",
        f"- Owner: {_normalize_multiline_field(payload.get('owner', '')) or 'Not provided'}",
        f"- Reviewers: {_normalize_multiline_field(payload.get('reviewers', '')) or 'Not provided'}",
        f"- Version: {_normalize_multiline_field(payload.get('version', '')) or 'Not provided'}",
        f"- Tags: {_normalize_multiline_field(payload.get('tags', '')) or 'Not provided'}",
        f"- File: {target_name}",
        "",
    ])

    _append_markdown_section(lines, "Examples", _normalize_multiline_field(payload.get("examples", "")))
    _append_markdown_section(lines, "Success Metrics", _normalize_multiline_field(payload.get("success_metrics", "")))
    return "\n".join(lines)


def _build_instruction_markdown(target_name: str, payload: dict) -> str:
    title = _normalize_multiline_field(payload.get("title", ""))
    lines = [f"# {title}", ""]

    _append_markdown_section(lines, "Objective", _normalize_multiline_field(payload.get("objective", "")), required=True)
    _append_markdown_section(lines, "Audience", _normalize_multiline_field(payload.get("audience", "")))
    _append_markdown_section(lines, "Prerequisites", _normalize_multiline_field(payload.get("prerequisites", "")))
    _append_markdown_section(lines, "Inputs", _normalize_multiline_field(payload.get("inputs", "")))
    _append_markdown_section(lines, "Steps", _normalize_multiline_field(payload.get("steps", "")), required=True)
    _append_markdown_section(lines, "Validation and Acceptance", _normalize_multiline_field(payload.get("validation", "")))
    _append_markdown_section(lines, "Rollback/Contingency", _normalize_multiline_field(payload.get("rollback", "")))
    _append_markdown_section(lines, "References", _normalize_multiline_field(payload.get("references", "")))
    _append_markdown_section(lines, "Notes", _normalize_multiline_field(payload.get("notes", "")))
    _append_markdown_section(lines, "Risks", _normalize_multiline_field(payload.get("risks", "")))

    lines.extend([
        "## Governance",
        f"- Owner: {_normalize_multiline_field(payload.get('owner', '')) or 'Not provided'}",
        f"- Approvers: {_normalize_multiline_field(payload.get('approvers', '')) or 'Not provided'}",
        f"- Frequency: {_normalize_multiline_field(payload.get('frequency', '')) or 'Not provided'}",
        f"- SLA/Target timeline: {_normalize_multiline_field(payload.get('sla', '')) or 'Not provided'}",
        f"- Tags: {_normalize_multiline_field(payload.get('tags', '')) or 'Not provided'}",
        f"- File: {target_name}",
        "",
    ])
    return "\n".join(lines)


@app.route(config.get("APP_UI_PATH", "/"))
def index():
    client_config = {
        "generateDocumentRoute": config.get("APP_ROUTE_GENERATE_DOCUMENT", "/api/generate/document"),
        "generateConfluenceRoute": config.get("APP_ROUTE_GENERATE_CONFLUENCE", "/api/generate/confluence"),
        "generateJiraRoute": config.get("APP_ROUTE_GENERATE_JIRA", "/api/generate/jira"),
        "outputContentRoute": config.get("APP_ROUTE_OUTPUT_CONTENT", "/api/output/content"),
        "outputDownloadRoute": config.get("APP_ROUTE_OUTPUT_DOWNLOAD", "/api/output/download"),
        "referenceFilesRoute": "/api/reference-files",
        "createSkillRoute": "/api/skills/create",
        "createInstructionRoute": "/api/instructions/create",
        "devDocsRoute": "/dev-docs",
    }
    return render_template("index.html", app_config=client_config)


@app.route(config.get("APP_HEALTH_PATH", "/health"), methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/dev-docs", methods=["GET"])
def open_dev_docs():
    target = (ARCHITECTURE_DIR / "architecture.html").resolve()
    if not target.exists():
        return jsonify({"error": "architecture.html not found"}), 404
    return send_file(target)


@app.route("/api/reference-files", methods=["GET"])
def get_reference_files():
    return jsonify(
        {
            "skills": _list_markdown_files(SKILLS_DIR),
            "instructions": _list_markdown_files(INSTRUCTIONS_DIR),
        }
    )


@app.route("/api/skills/create", methods=["POST"])
def create_skill_file():
    payload = request.get_json(force=True)
    file_name = payload.get("file_name", "")

    missing_fields = _validate_required_fields(payload, SKILL_REQUIRED_FIELDS)
    if missing_fields:
        return jsonify({"error": f"Missing required fields: {', '.join(missing_fields)}"}), 400

    try:
        target = _safe_target_file(SKILLS_DIR, file_name)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    if target.exists():
        return jsonify({"error": "A skill file with that name already exists."}), 400

    content = _build_skill_markdown(target.name, payload)
    target.write_text(content, encoding="utf-8")
    return jsonify({"file": target.name})


@app.route("/api/instructions/create", methods=["POST"])
def create_instruction_file():
    payload = request.get_json(force=True)
    file_name = payload.get("file_name", "")

    missing_fields = _validate_required_fields(payload, INSTRUCTION_REQUIRED_FIELDS)
    if missing_fields:
        return jsonify({"error": f"Missing required fields: {', '.join(missing_fields)}"}), 400

    try:
        target = _safe_target_file(INSTRUCTIONS_DIR, file_name)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400

    if target.exists():
        return jsonify({"error": "An instruction file with that name already exists."}), 400

    content = _build_instruction_markdown(target.name, payload)
    target.write_text(content, encoding="utf-8")
    return jsonify({"file": target.name})


@app.route(config.get("APP_ROUTE_GENERATE_DOCUMENT", "/api/generate/document"), methods=["POST"])
def generate_from_document():
    output_format = request.form.get("output_format", "bdd")
    uploaded = request.files.get("file")

    if not uploaded:
        return jsonify({"error": "No file uploaded"}), 400

    TEMP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    temp_file = TEMP_UPLOAD_DIR / uploaded.filename
    uploaded.save(temp_file)

    outputs = service.process_document(str(temp_file), output_format)
    return jsonify({"outputs": [str(path) for path in outputs]})


@app.route(config.get("APP_ROUTE_GENERATE_CONFLUENCE", "/api/generate/confluence"), methods=["POST"])
def generate_from_confluence():
    payload = request.get_json(force=True)
    url = payload.get("url", "").strip()
    output_format = payload.get("output_format", "bdd")
    username = payload.get("username", "").strip()
    password = payload.get("password", "")

    if not url:
        return jsonify({"error": "Confluence URL or page ID is required"}), 400
    if not username or not password:
        return jsonify({"error": "Username and password are required for Confluence."}), 400

    outputs = service.process_confluence(
        url,
        output_format,
        username=username,
        password=password,
    )
    return jsonify({"outputs": [str(path) for path in outputs]})


@app.route(config.get("APP_ROUTE_GENERATE_JIRA", "/api/generate/jira"), methods=["POST"])
def generate_from_jira():
    payload = request.get_json(force=True)
    story_ids_raw = payload.get("story_ids", "")
    output_format = payload.get("output_format", "bdd")
    username = payload.get("username", "").strip()
    password = payload.get("password", "")

    story_ids = [x.strip() for x in story_ids_raw.split(",") if x.strip()]
    if not story_ids:
        return jsonify({"error": "At least one story ID is required"}), 400
    if not username or not password:
        return jsonify({"error": "Username and password are required for Jira/JTMF."}), 400

    outputs = service.process_jira(
        story_ids,
        output_format,
        username=username,
        password=password,
    )
    return jsonify({"outputs": [str(path) for path in outputs]})


@app.route(config.get("APP_ROUTE_OUTPUT_CONTENT", "/api/output/content"), methods=["GET"])
def get_output_content():
    file_name = request.args.get("file", "").strip()
    try:
        output_file = _resolve_output_file(file_name)
    except (ValueError, FileNotFoundError) as error:
        return jsonify({"error": str(error)}), 400

    if output_file.suffix.lower() not in {".feature", ".csv", ".txt", ".log"}:
        return jsonify({"error": "Preview unsupported for this file type"}), 400

    content = output_file.read_text(encoding="utf-8", errors="replace")
    return jsonify({"file": output_file.name, "content": content})


@app.route(config.get("APP_ROUTE_OUTPUT_DOWNLOAD", "/api/output/download"), methods=["GET"])
def download_output_file():
    file_name = request.args.get("file", "").strip()
    try:
        output_file = _resolve_output_file(file_name)
    except (ValueError, FileNotFoundError) as error:
        return jsonify({"error": str(error)}), 400

    response = send_file(output_file, as_attachment=True, download_name=output_file.name)

    @response.call_on_close
    def _cleanup_generated_artifacts() -> None:
        keep = {".gitkeep"}
        if config.get_bool("APP_OUTPUT_RETENTION_KEEP_LOGS", True):
            keep.add(Path(config.get("APP_LOG_FILE", "output/platform.log")).name)
        clear_directory(str(OUTPUT_DIR), keep_names=keep)
        clear_directory(str(TEMP_UPLOAD_DIR), keep_names=set())

    return response


if __name__ == "__main__":
    configure_logging(config.get("APP_LOG_FILE", "output/platform.log"))
    app.run(
        host=config.get("APP_HOST", "0.0.0.0"),
        port=config.get_int("APP_PORT", 5050),
        debug=False,
    )
