# Builds test/fixture.pptx (needs python-pptx). The committed fixture is what the tests read.
# test/fixture.odp is the same deck saved by LibreOffice: soffice --headless --convert-to odp fixture.pptx
from pptx import Presentation
from pptx.util import Pt
prs = Presentation()
def add(title, notes=None, hidden=False, layout=1):
    s = prs.slides.add_slide(prs.slide_layouts[layout])
    if s.shapes.title is not None: s.shapes.title.text = title
    if notes is not None:
        tf = s.notes_slide.notes_text_frame
        paras = notes.split("\n\n")
        tf.text = paras[0]
        for p in paras[1:]:
            tf.add_paragraph().text = p
    if hidden: s._element.set("show", "0")
    return s
add("Welcome", "Welcome everyone.\n\nToday: results, roadmap & Q&A.")
s = add("Line breaks", "First line")
r = s.notes_slide.notes_text_frame.paragraphs[0]
r.add_line_break(); r.add_run().text = "Second line <after> a break"
add("No notes")
add("Hidden one", "Secret notes", hidden=True)
add("Unicode", "Café — “quotes” ✓ 日本語")
prs.save("fixture.pptx")
