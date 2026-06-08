from __future__ import annotations

import csv
from pathlib import Path

from docx import Document
from openpyxl import load_workbook
from pypdf import PdfReader

from models.requirement import RequirementArtifact


class DocumentReader:
    SUPPORTED_TYPES = {"docx", "xlsx", "pdf", "csv"}

    def read(self, file_path: str) -> RequirementArtifact:
        path = Path(file_path)
        ext = path.suffix.lower().replace(".", "")

        if ext not in self.SUPPORTED_TYPES:
            raise ValueError(f"Unsupported file type: {ext}")

        raw_text = {
            "docx": self._read_docx,
            "xlsx": self._read_xlsx,
            "pdf": self._read_pdf,
            "csv": self._read_csv,
        }[ext](path)

        return RequirementArtifact(
            source_type="document",
            title=path.stem,
            raw_text=raw_text,
            metadata={"file_path": str(path), "file_type": ext},
        )

    def _read_docx(self, path: Path) -> str:
        doc = Document(path)
        paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
        return "\n".join(paragraphs)

    def _read_xlsx(self, path: Path) -> str:
        workbook = load_workbook(path, data_only=True)
        content = []
        for sheet_name in workbook.sheetnames:
            worksheet = workbook[sheet_name]
            content.append(f"## Sheet: {sheet_name}")

            rows = []
            for row in worksheet.iter_rows(values_only=True):
                normalized = ["" if cell is None else str(cell) for cell in row]
                if any(col.strip() for col in normalized):
                    rows.append(normalized)

            if not rows:
                content.append("(empty sheet)")
                continue

            csv_lines = []
            for row in rows:
                escaped = [f'"{col.replace("\"", "\"\"")}"' for col in row]
                csv_lines.append(",".join(escaped))
            content.append("\n".join(csv_lines))

        return "\n".join(content)

    def _read_pdf(self, path: Path) -> str:
        reader = PdfReader(str(path))
        pages = []
        for idx, page in enumerate(reader.pages, start=1):
            page_text = page.extract_text() or ""
            pages.append(f"## Page {idx}\n{page_text.strip()}")
        return "\n\n".join(pages)

    def _read_csv(self, path: Path) -> str:
        rows = []
        with path.open("r", encoding="utf-8-sig", newline="") as csv_file:
            reader = csv.reader(csv_file)
            for row in reader:
                rows.append(["" if col is None else str(col) for col in row])

        csv_lines = []
        for row in rows:
            escaped = [f'"{col.replace("\"", "\"\"")}"' for col in row]
            csv_lines.append(",".join(escaped))
        return "\n".join(csv_lines)
