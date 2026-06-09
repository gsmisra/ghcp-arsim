from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import requests
from flask import Flask, jsonify, render_template, request, send_file

CORE_LOGIC_PATH = Path(__file__).resolve().parent / "core-logic"
if str(CORE_LOGIC_PATH) not in sys.path:
    sys.path.insert(0, str(CORE_LOGIC_PATH))

from config_loader import Config  # noqa: E402
from qe_service import QEAgenticPlatformService  # noqa: E402
from models.requirement import GeneratedTestCase, RequirementArtifact  # noqa: E402
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
GHCP_BRIDGE_BASE_URL = config.get("GHCP_BRIDGE_BASE_URL", "http://127.0.0.1:8765").rstrip("/")
GHCP_BRIDGE_AUTH_TOKEN = config.get("GHCP_BRIDGE_AUTH_TOKEN", "")
PROMPTS_DB_PATH = Path("arsim.db").resolve()

SKILL_REQUIRED_FIELDS = ("file_name", "title", "purpose")
INSTRUCTION_REQUIRED_FIELDS = ("file_name", "title", "objective", "steps")


def _init_prompts_db() -> None:
    connection = sqlite3.connect(PROMPTS_DB_PATH)
    try:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS prompts_table (
                prompt_keyword TEXT PRIMARY KEY,
                prompt_text TEXT NOT NULL
            )
            """
        )
        connection.commit()
    finally:
        connection.close()


def _get_db_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(PROMPTS_DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


_init_prompts_db()


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


def _call_ghcp_bridge(payload: dict) -> dict:
    headers = {"Content-Type": "application/json"}
    if GHCP_BRIDGE_AUTH_TOKEN:
        headers["Authorization"] = f"Bearer {GHCP_BRIDGE_AUTH_TOKEN}"

    response = requests.post(
        f"{GHCP_BRIDGE_BASE_URL}/v1/generate",
        headers=headers,
        json=payload,
        timeout=config.get_int("GHCP_BRIDGE_TIMEOUT_SECONDS", 180),
    )

    if response.status_code >= 400:
        bridge_error = "Unknown bridge error"
        try:
            body = response.json()
            bridge_error = body.get("error") or str(body)
        except ValueError:
            bridge_error = response.text or bridge_error
        raise RuntimeError(f"GHCP bridge returned {response.status_code}: {bridge_error}")

    return response.json()


def _coerce_generated_test_cases(items: list[dict]) -> list[GeneratedTestCase]:
    cases: list[GeneratedTestCase] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        cases.append(
            GeneratedTestCase(
                scenario_name=str(item.get("scenario_name", "GHCP Scenario")),
                objective=str(item.get("objective", "GHCP generated objective")),
                preconditions=[str(x) for x in item.get("preconditions", []) if str(x).strip()],
                steps=[str(x) for x in item.get("steps", []) if str(x).strip()],
                expected_results=[str(x) for x in item.get("expected_results", []) if str(x).strip()],
                tags=[str(x) for x in item.get("tags", []) if str(x).strip()],
                examples=[example for example in item.get("examples", []) if isinstance(example, dict)],
            )
        )
    return cases


def _combine_artifacts(artifacts: list[RequirementArtifact], source_type: str, title: str) -> RequirementArtifact:
    raw_sections: list[str] = []
    metadata_sources: list[dict] = []
    for artifact in artifacts:
        raw_sections.append(f"### {artifact.title}\n{artifact.raw_text}")
        metadata_sources.append(artifact.metadata)

    return RequirementArtifact(
        source_type=source_type,
        title=title,
        raw_text="\n\n".join(raw_sections),
        metadata={"sources": metadata_sources},
    )


def _parse_document_read_options(req: request) -> dict:
    options: dict = {}
    page_start = _normalize_multiline_field(req.form.get("page_start", ""))
    page_end = _normalize_multiline_field(req.form.get("page_end", ""))
    row_start = _normalize_multiline_field(req.form.get("row_start", ""))
    row_end = _normalize_multiline_field(req.form.get("row_end", ""))
    sheet_names = [item.strip() for item in req.form.getlist("sheet_names") if item and item.strip()]

    if page_start:
        options["page_start"] = int(page_start)
    if page_end:
        options["page_end"] = int(page_end)
    if row_start:
        options["row_start"] = int(row_start)
    if row_end:
        options["row_end"] = int(row_end)
    if sheet_names:
        options["sheet_names"] = sheet_names
    return options


def _read_selected_markdown(directory: Path, names: list[str]) -> tuple[list[str], str]:
    selected: list[str] = []
    content_sections: list[str] = []
    for item in names:
        target = _safe_target_file(directory, item)
        if not target.exists() or not target.is_file():
            raise ValueError(f"Selected file not found: {item}")
        selected.append(target.name)
        content = target.read_text(encoding="utf-8")
        content_sections.append(f"### {target.name}\n{content}")
    return selected, "\n\n".join(content_sections)


def _collect_reference_context(req: request) -> tuple[dict, str]:
    skill_names = [item.strip() for item in req.form.getlist("selected_skills") if item and item.strip()]
    instruction_names = [item.strip() for item in req.form.getlist("selected_instructions") if item and item.strip()]

    selected_skills, skills_content = _read_selected_markdown(SKILLS_DIR, skill_names)
    selected_instructions, instructions_content = _read_selected_markdown(INSTRUCTIONS_DIR, instruction_names)

    parts = []
    if skills_content:
        parts.append(f"## Selected Skills\n{skills_content}")
    if instructions_content:
        parts.append(f"## Selected Instructions\n{instructions_content}")

    return (
        {
            "selected_skills": selected_skills,
            "selected_instructions": selected_instructions,
        },
        "\n\n".join(parts),
    )


def _build_combined_context(artifact: RequirementArtifact, source_context: str, reference_context: str) -> str:
    parts = [artifact.raw_text]
    if source_context:
        parts.append(f"## Optional Source Context\n{source_context}")
    if reference_context:
        parts.append(reference_context)
    return "\n\n".join([part for part in parts if part and part.strip()])


def _resolve_final_context(artifact: RequirementArtifact, source_context: str, reference_context: str, parsed_override: str) -> str:
    override = _normalize_multiline_field(parsed_override)
    if override:
        return override
    return _build_combined_context(artifact, source_context, reference_context)


def _build_requirement_artifact_from_request(req: request) -> tuple[RequirementArtifact, str]:
    source_type = (req.form.get("source") or req.form.get("source_type") or "document").strip().lower()
    prompt = _normalize_multiline_field(req.form.get("prompt", ""))
    default_prompt = prompt or "Generate detailed enterprise BDD test cases only from the provided source content."

    if source_type == "document":
        uploaded = req.files.get("file")
        if not uploaded:
            raise ValueError("A document file is required for document source type.")

        TEMP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        temp_file = TEMP_UPLOAD_DIR / uploaded.filename
        uploaded.save(temp_file)
        parse_options = _parse_document_read_options(req)
        artifact = service.document_reader.read(str(temp_file), options=parse_options)
        return artifact, default_prompt

    if source_type == "confluence":
        url = _normalize_multiline_field(req.form.get("source_url") or req.form.get("url") or "")
        username = _normalize_multiline_field(req.form.get("username", ""))
        password = req.form.get("password", "")
        if not url:
            raise ValueError("Confluence URL or page ID is required.")
        if not username or not password:
            raise ValueError("Username and password are required for Confluence.")

        raw_text = service.confluence_reader.read_recursive(
            url,
            working_dir=service.temp_upload_dir,
            username=username,
            password=password,
        )
        return (
            RequirementArtifact(
                source_type="confluence",
                title=url.replace("/", "_").replace(" ", "_") or "confluence_source",
                raw_text=raw_text,
                metadata={"source": url},
            ),
            default_prompt,
        )

    if source_type == "jira":
        story_ids_raw = _normalize_multiline_field(req.form.get("story_ids") or req.form.get("source_url") or "")
        username = _normalize_multiline_field(req.form.get("username", ""))
        password = req.form.get("password", "")
        story_ids = [item.strip() for item in story_ids_raw.split(",") if item.strip()]
        if not story_ids:
            raise ValueError("At least one Jira/JTMF story ID is required.")
        if not username or not password:
            raise ValueError("Username and password are required for Jira/JTMF.")

        artifacts = service.jira_reader.read_stories(
            story_ids,
            username=username,
            password=password,
        )
        title = "_".join(story_ids) or "jira_source"
        return _combine_artifacts(artifacts, "jira", title), default_prompt

    raise ValueError(f"Unsupported source type: {source_type}")


def _feature_name_from_artifact(title: str) -> str:
    return f"{title or 'ghcp_generated_feature'}.feature" if not str(title or '').endswith('.feature') else title


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
        "outputContentRoute": config.get("APP_ROUTE_OUTPUT_CONTENT", "/api/output/content"),
        "outputDownloadRoute": config.get("APP_ROUTE_OUTPUT_DOWNLOAD", "/api/output/download"),
        "referenceFilesRoute": "/api/reference-files",
        "createSkillRoute": "/api/skills/create",
        "createInstructionRoute": "/api/instructions/create",
        "ghcpBridgeHealthRoute": "/api/ghcp/health",
        "ghcpPackageRoute": "/api/ghcp/package-and-generate",
        "ghcpSourcePreviewRoute": "/api/ghcp/source-preview",
        "documentSheetsRoute": "/api/document/sheets",
        "ghcpSaveFeatureRoute": "/api/ghcp/save-feature",
        "promptsListRoute": "/api/prompts",
        "promptsGetRoute": "/api/prompts/get",
        "promptsSaveRoute": "/api/prompts/save",
        "ghcpBridgeBaseUrl": GHCP_BRIDGE_BASE_URL,
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


@app.route("/api/prompts", methods=["GET"])
def list_saved_prompts():
    connection = _get_db_connection()
    try:
        rows = connection.execute(
            "SELECT prompt_keyword FROM prompts_table ORDER BY prompt_keyword COLLATE NOCASE"
        ).fetchall()
        keywords = [row["prompt_keyword"] for row in rows]
        return jsonify({"keywords": keywords})
    finally:
        connection.close()


@app.route("/api/prompts/get", methods=["GET"])
def get_saved_prompt():
    keyword = _normalize_multiline_field(request.args.get("keyword", ""))
    if not keyword:
        return jsonify({"error": "Prompt keyword is required."}), 400

    connection = _get_db_connection()
    try:
        row = connection.execute(
            "SELECT prompt_keyword, prompt_text FROM prompts_table WHERE prompt_keyword = ?",
            (keyword,),
        ).fetchone()
        if row is None:
            return jsonify({"error": "Prompt keyword not found."}), 404
        return jsonify({"keyword": row["prompt_keyword"], "prompt_text": row["prompt_text"]})
    finally:
        connection.close()


@app.route("/api/prompts/save", methods=["POST"])
def save_prompt():
    payload = request.get_json(force=True)
    keyword = _normalize_multiline_field(payload.get("keyword", ""))
    prompt_text = _normalize_multiline_field(payload.get("prompt_text", ""))

    if not keyword:
        return jsonify({"error": "Prompt keyword is required."}), 400
    if not prompt_text:
        return jsonify({"error": "Prompt text is required."}), 400

    connection = _get_db_connection()
    try:
        connection.execute(
            """
            INSERT INTO prompts_table (prompt_keyword, prompt_text)
            VALUES (?, ?)
            ON CONFLICT(prompt_keyword) DO UPDATE SET prompt_text = excluded.prompt_text
            """,
            (keyword, prompt_text),
        )
        connection.commit()
        return jsonify({"keyword": keyword})
    finally:
        connection.close()


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


@app.route("/api/ghcp/package-and-generate", methods=["POST"])
def ghcp_package_and_generate():
    try:
        artifact, prompt = _build_requirement_artifact_from_request(request)
        source_context = _normalize_multiline_field(request.form.get("source_context", ""))
        parsed_override = _normalize_multiline_field(request.form.get("parsed_override", ""))
        selected_reference_meta, reference_context = _collect_reference_context(request)
        combined_context = _resolve_final_context(artifact, source_context, reference_context, parsed_override)

        max_cases = config.get_int("GHCP_BRIDGE_MAX_CASES", 5)
        bridge_payload = {
            "instruction": prompt,
            "max_cases": max_cases,
            "artifact": {
                "source_type": artifact.source_type,
                "title": artifact.title,
                "raw_text": combined_context,
                "metadata": {**artifact.metadata, **selected_reference_meta},
            },
        }
        response_payload = _call_ghcp_bridge(bridge_payload)
        return jsonify({
            "artifact": {
                "source_type": artifact.source_type,
                "title": artifact.title,
                "metadata": {**artifact.metadata, **selected_reference_meta},
            },
            "response": response_payload,
        })
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except RuntimeError as error:
        return jsonify({"error": str(error)}), 502
    except requests.RequestException as error:
        return jsonify({"error": f"GHCP bridge unavailable: {error}"}), 502


@app.route("/api/ghcp/source-preview", methods=["POST"])
def ghcp_source_preview():
    try:
        artifact, prompt = _build_requirement_artifact_from_request(request)
        source_context = _normalize_multiline_field(request.form.get("source_context", ""))
        parsed_override = _normalize_multiline_field(request.form.get("parsed_override", ""))
        selected_reference_meta, reference_context = _collect_reference_context(request)
        combined_context = _resolve_final_context(artifact, source_context, reference_context, parsed_override)

        return jsonify(
            {
                "prompt": prompt,
                "artifact": {
                    "source_type": artifact.source_type,
                    "title": artifact.title,
                    "metadata": {**artifact.metadata, **selected_reference_meta},
                },
                "combined_context": combined_context,
            }
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), 400


@app.route("/api/document/sheets", methods=["POST"])
def get_document_sheets():
    uploaded = request.files.get("file")
    if not uploaded:
        return jsonify({"error": "No file uploaded"}), 400

    TEMP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    temp_file = TEMP_UPLOAD_DIR / uploaded.filename
    uploaded.save(temp_file)

    try:
        sheets = service.document_reader.get_sheet_names(str(temp_file))
        return jsonify({"sheets": sheets})
    except ValueError as error:
        return jsonify({"error": str(error)}), 400


@app.route("/api/ghcp/save-feature", methods=["POST"])
def ghcp_save_feature():
    payload = request.get_json(force=True)
    response_payload = payload.get("response", {})
    artifact_payload = payload.get("artifact", {})
    source_type = _normalize_multiline_field(artifact_payload.get("source_type", "ghcp")) or "ghcp"
    title = _normalize_multiline_field(artifact_payload.get("title", "")) or _normalize_multiline_field(payload.get("title", "")) or "ghcp_generated_feature"

    test_cases_raw = response_payload.get("test_cases", [])
    if not isinstance(test_cases_raw, list) or not test_cases_raw:
        return jsonify({"error": "GHCP response does not contain any test cases."}), 400

    cases = _coerce_generated_test_cases(test_cases_raw)
    if not cases:
        return jsonify({"error": "Unable to convert GHCP response to test cases."}), 400

    artifact = RequirementArtifact(
        source_type=source_type,
        title=title,
        raw_text=_normalize_multiline_field(payload.get("raw_text", "")) or title,
        metadata={"origin": "ghcp_ui", **artifact_payload.get("metadata", {})},
    )

    output_path = service.bdd_generator.write_feature_file(artifact, cases, OUTPUT_DIR)
    return jsonify({"file": output_path.name, "path": str(output_path)})


@app.route("/api/ghcp/health", methods=["GET"])
def ghcp_health():
    try:
        response = requests.get(f"{GHCP_BRIDGE_BASE_URL}/health", timeout=10)
        response.raise_for_status()
        payload = response.json()
        payload["bridge_url"] = GHCP_BRIDGE_BASE_URL
        return jsonify(payload)
    except requests.RequestException as error:
        return jsonify({"error": f"GHCP bridge unavailable: {error}", "bridge_url": GHCP_BRIDGE_BASE_URL}), 502


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
