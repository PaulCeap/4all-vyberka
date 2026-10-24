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
    def test_xlsx_shared_inline_numeric_and_cached_formula(self):
        data = zipped({
            'xl/workbook.xml': '<workbook/>',
            'xl/sharedStrings.xml': '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Výroba videí</t></si></sst>',
            'xl/worksheets/sheet1.xml': '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row>'
                '<c t="s"><v>0</v></c><c t="inlineStr"><is><t>Cena</t></is></c><c><v>200000</v></c>'
                '<c><f>SUM(C1)</f><v>200000</v></c></row></sheetData></worksheet>',
        })
        self.assertEqual(extractor.extract(data), 'Výroba videí | Cena | 200000 | 200000')

    def test_login_html_is_not_treated_as_document(self):
        with self.assertRaisesRegex(ValueError, 'webovou stránku'):
            extractor.extract(b'<!doctype html><html>Login</html>')

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
