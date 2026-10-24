"""Read selected public tender attachments; output source text, never inferred facts."""

import io
import json
import re
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from urllib.parse import urlparse
from xml.etree import ElementTree

MAX_DOWNLOAD = 16 * 1024 * 1024
MAX_MEMBER = 8 * 1024 * 1024
MAX_TEXT = 75_000
USER_AGENT = "4ALL-vyberka/1.0 (hello@4all.cz)"


def read_url(url):
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.hostname in {"localhost", "127.0.0.1"}:
        raise ValueError("Podklad nemá veřejnou HTTPS adresu.")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                if response.url.startswith("http:"):
                    raise ValueError("Podklad se přesměroval na nešifrovanou adresu.")
                payload = response.read(MAX_DOWNLOAD + 1)
                if len(payload) > MAX_DOWNLOAD:
                    raise ValueError("Podklad překročil velikostní limit 16 MB.")
                return payload
        except urllib.error.HTTPError as error:
            if attempt == 2 or error.code not in {408, 429, 500, 502, 503, 504}:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(attempt + 1)


def pdf_text(payload):
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "document.pdf"
        path.write_bytes(payload)
        result = subprocess.run(
            ["pdftotext", "-layout", str(path), "-"],
            capture_output=True, timeout=25, check=False,
        )
        if result.returncode:
            raise ValueError("PDF nešlo převést na text.")
        return result.stdout.decode("utf-8", "replace")


def docx_text(archive):
    names = [name for name in archive.namelist() if name.startswith("word/") and name.endswith(".xml")
             and (name == "word/document.xml" or "/header" in name)]
    lines = []
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    for name in names[:6]:
        if archive.getinfo(name).file_size > MAX_MEMBER:
            continue
        root = ElementTree.fromstring(archive.read(name))
        for paragraph in root.iter(ns + "p"):
            line = "".join(part.text or "" for part in paragraph.iter(ns + "t")).strip()
            if line:
                lines.append(line)
    return "\n".join(lines)


def member_priority(name):
    name = ''.join(c for c in unicodedata.normalize('NFD', name.casefold()) if not unicodedata.combining(c))
    if re.search(r"(cestn|kryci|pruvodn|identifikac|sankc|provozni rad)", name):
        return -1
    if re.search(r"(zadavac|pokyn|specifikac|predmet|předmět|libreto|vyzva|výzva)", name):
        return 3
    return 1 if name.endswith((".pdf", ".docx", ".xlsx")) else -1


def xlsx_text(archive):
    """Read cached cell values; never execute formulas, macros or external links."""
    ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    def xml(name):
        if archive.getinfo(name).file_size > MAX_MEMBER:
            raise ValueError('List tabulky překročil velikostní limit.')
        return ElementTree.fromstring(archive.read(name))
    strings = []
    if 'xl/sharedStrings.xml' in archive.namelist():
        strings = [''.join(node.itertext()) for node in xml('xl/sharedStrings.xml').iter(ns + 'si')]
    lines = []
    sheets = sorted(n for n in archive.namelist() if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', n))[:12]
    for sheet in sheets:
        for row in xml(sheet).iter(ns + 'row'):
            cells = []
            for cell in row.findall(ns + 'c'):
                value = cell.findtext(ns + 'v', '')
                if cell.get('t') == 's':
                    value = strings[int(value)] if value.isdigit() and int(value) < len(strings) else ''
                elif cell.get('t') == 'inlineStr':
                    value = ''.join(cell.find(ns + 'is').itertext()) if cell.find(ns + 'is') is not None else ''
                if value:
                    cells.append(value)
            if cells:
                lines.append(' | '.join(cells))
            if sum(map(len, lines)) > MAX_TEXT:
                return '\n'.join(lines)[:MAX_TEXT]
    return '\n'.join(lines)


def extract(payload, depth=0):
    if payload.startswith(b"%PDF-"):
        return pdf_text(payload)
    if payload.startswith(b"PK\x03\x04"):
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            if "word/document.xml" in archive.namelist():
                return docx_text(archive)
            if "xl/workbook.xml" in archive.namelist():
                return xlsx_text(archive)
            if depth >= 2:
                raise ValueError("Příliš hluboko vnořený archiv.")
            members = sorted(
                (item for item in archive.infolist() if not item.is_dir() and
                 item.file_size <= MAX_MEMBER and member_priority(item.filename) >= 0),
                key=lambda item: (-member_priority(item.filename), item.filename),
            )[:8]
            parts = []
            for item in members:
                try:
                    text = extract(archive.read(item), depth + 1)
                    if text.strip():
                        parts.append(text)
                except (ValueError, zipfile.BadZipFile, subprocess.TimeoutExpired):
                    continue
            if parts:
                return "\n\n".join(parts)
            raise ValueError("Archiv neobsahuje čitelné věcné PDF, DOCX nebo XLSX.")
    if payload.startswith((b"{\\rtf", b"\xd0\xcf\x11\xe0")):
        raise ValueError("Starý DOC/RTF zatím neumíme bezpečně přečíst.")
    if re.search(br'<(?:!doctype\s+html|html)\b', payload[:1024], re.I):
        raise ValueError('Zdroj místo dokumentu vrátil webovou stránku (přihlášení nebo chyba).')
    raise ValueError('Nepodporovaný formát přílohy.')


def main():
    tender = json.load(sys.stdin)
    results = []
    for document in tender.get("documents", [])[:3]:
        result = {"name": str(document.get("name", "")), "url": str(document.get("url", ""))}
        try:
            text = extract(read_url(result["url"]))
            text = re.sub(r"[ \t]+", " ", text).replace("\r", "\n")
            text = re.sub(r"\n{3,}", "\n\n", text).strip()
            if len(text) < 80:
                raise ValueError("Dokument nemá dost strojově čitelného textu.")
            result["text"] = text[:MAX_TEXT]
        except (OSError, ValueError, urllib.error.URLError, zipfile.BadZipFile,
                subprocess.TimeoutExpired) as error:
            result["error"] = str(error)[:180]
        results.append(result)
    print(json.dumps({"documents": results}, ensure_ascii=False))


if __name__ == "__main__":
    main()
