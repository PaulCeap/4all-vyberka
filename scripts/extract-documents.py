"""Read selected public tender attachments; output source text, never inferred facts."""

import io
import json
import re
import subprocess
import sys
import tempfile
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
    with urllib.request.urlopen(request, timeout=25) as response:
        if response.url.startswith("http:"):
            raise ValueError("Podklad se přesměroval na nešifrovanou adresu.")
        payload = response.read(MAX_DOWNLOAD + 1)
        if len(payload) > MAX_DOWNLOAD:
            raise ValueError("Podklad překročil velikostní limit 16 MB.")
        return payload


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
    name = name.casefold()
    if re.search(r"(cestn|kryci|pruvodn|smlouv|identifikac|podpis|sankc|provozni rad)", name):
        return -1
    if re.search(r"(zadavac|pokyn|specifikac|predmet|předmět|libreto|vyzva|výzva)", name):
        return 3
    return 1 if name.endswith((".pdf", ".docx")) else -1


def extract(payload, depth=0):
    if payload.startswith(b"%PDF-"):
        return pdf_text(payload)
    if payload.startswith(b"PK\x03\x04"):
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            if "word/document.xml" in archive.namelist():
                return docx_text(archive)
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
            raise ValueError("Archiv neobsahuje čitelné věcné PDF nebo DOCX.")
    if payload.startswith((b"{\\rtf", b"\xd0\xcf\x11\xe0")):
        raise ValueError("Starý DOC/RTF zatím neumíme bezpečně přečíst.")
    return payload.decode("utf-8", "replace")


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
