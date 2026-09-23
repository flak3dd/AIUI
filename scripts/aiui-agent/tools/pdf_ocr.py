"""Local PDF → Markdown via pymupdf4llm. Reads one JSON object from stdin."""
import inspect
import json
import os
import sys

import pymupdf
import pymupdf4llm

MAX_CHARS = 80_000
MAX_PAGES_CAP = 40


def _engine_version():
    return (
        getattr(pymupdf4llm, "__version__", None)
        or getattr(pymupdf4llm, "VERSION", None)
        or getattr(pymupdf4llm, "version", None)
        or "unknown"
    )


def _to_markdown_kwargs(pages, force_ocr):
    """Build kwargs for the installed pymupdf4llm.to_markdown signature."""
    sig = inspect.signature(pymupdf4llm.to_markdown)
    params = sig.parameters
    kwargs = {"pages": pages, "show_progress": False}
    supports_use_ocr = "use_ocr" in params
    if supports_use_ocr:
        kwargs["use_ocr"] = True
    if force_ocr and "force_ocr" in params:
        kwargs["force_ocr"] = True
    return kwargs, supports_use_ocr


def _ocr_page_text(page, force):
    """PyMuPDF OCR fallback when to_markdown has no use_ocr (pymupdf4llm≤0.0.27)."""
    text = page.get_text("text") or ""
    sparse = len(text.strip()) < 40
    if not force and not sparse:
        return None, False, None
    try:
        tp = page.get_textpage_ocr(language="eng", dpi=200, full=bool(force))
        ocr_text = page.get_text("text", textpage=tp) or ""
    except Exception as err:
        return None, False, str(err)
    if len(ocr_text.strip()) > len(text.strip()):
        return ocr_text, True, None
    return None, False, None


def _markdown_with_ocr_fallback(doc, pages, force):
    chunks = pymupdf4llm.to_markdown(
        doc, pages=pages, page_chunks=True, show_progress=False
    )
    parts = []
    ocr_pages = 0
    ocr_error = None
    for i, chunk in enumerate(chunks):
        page = doc[pages[i]]
        text = chunk.get("text") or ""
        fb, used, err = _ocr_page_text(page, force)
        if err and not ocr_error:
            ocr_error = err
        if used and fb:
            ocr_pages += 1
            parts.append(fb.strip())
        else:
            parts.append(text.strip())
    return "\n\n".join(p for p in parts if p), ocr_pages, ocr_error


def main():
    req = json.load(sys.stdin)
    raw_in = str(req.get("path") or "").strip()
    if not raw_in:
        json.dump({"ok": False, "error": "Path required"}, sys.stdout)
        return
    if ".." in raw_in:
        json.dump({"ok": False, "error": "Directory traversal is not allowed"}, sys.stdout)
        return
    if not os.path.isabs(os.path.expanduser(raw_in)):
        json.dump({"ok": False, "error": "PDF path must be absolute"}, sys.stdout)
        return
    raw = os.path.realpath(os.path.expanduser(raw_in))
    if not raw.lower().endswith(".pdf"):
        json.dump({"ok": False, "error": "Path must be a .pdf file"}, sys.stdout)
        return
    if not os.path.isfile(raw):
        json.dump({"ok": False, "error": "PDF not found", "path": raw}, sys.stdout)
        return

    max_pages = max(1, min(int(req.get("maxPages") or 20), MAX_PAGES_CAP))
    force = bool(req.get("forceOcr"))

    doc = pymupdf.open(raw)
    page_count = doc.page_count
    pages = list(range(min(max_pages, page_count)))
    ocr_pages = 0
    ocr_error = None
    truncated = False
    notes = []

    try:
        kwargs, supports_use_ocr = _to_markdown_kwargs(pages, force)
        if supports_use_ocr:
            markdown = pymupdf4llm.to_markdown(doc, **kwargs) or ""
            if force:
                ocr_pages = len(pages)
        else:
            markdown, ocr_pages, ocr_error = _markdown_with_ocr_fallback(doc, pages, force)
    finally:
        doc.close()

    if page_count > max_pages:
        truncated = True
        notes.append(f"Limited to {max_pages} of {page_count} pages")
    if len(markdown) > MAX_CHARS:
        markdown = markdown[:MAX_CHARS]
        truncated = True
        notes.append(f"Truncated to {MAX_CHARS} characters")

    json.dump(
        {
            "ok": True,
            "path": raw,
            "pageCount": page_count,
            "pagesReturned": len(pages),
            "markdown": markdown,
            "truncated": truncated,
            "truncationNote": "; ".join(notes) if notes else None,
            "ocrPages": ocr_pages,
            "ocrError": ocr_error,
            "engine": "pymupdf4llm",
            "engineVersion": _engine_version(),
        },
        sys.stdout,
    )


if __name__ == "__main__":
    main()
