import importlib.util
import io
import unittest
import zipfile
from pathlib import Path


SPEC = importlib.util.spec_from_file_location(
    "extract_documents", Path(__file__).resolve().parents[1] / "scripts" / "extract-documents.py"
)
extractor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(extractor)


def zipped(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for name, payload in files.items():
            archive.writestr(name, payload)
    return output.getvalue()


class ExtractionTests(unittest.TestCase):
    def test_docx_and_nested_zip_preserve_document_text(self):
        docx = zipped({
            "word/document.xml": (
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                '<w:body><w:p><w:r><w:t>Produkce eventů</w:t></w:r></w:p></w:body></w:document>'
            )
        })
        self.assertEqual(extractor.extract(docx), "Produkce eventů")
        bundle = zipped({"zadani/technicka-specifikace.docx": docx,
                         "zadani/kryci-list.docx": docx})
        self.assertEqual(extractor.extract(bundle), "Produkce eventů")

    def test_archive_without_readable_material_reports_error(self):
        with self.assertRaisesRegex(ValueError, "neobsahuje čitelné"):
            extractor.extract(zipped({"formulare/kryci-list.docx": b"not-a-docx"}))


if __name__ == "__main__":
    unittest.main()
