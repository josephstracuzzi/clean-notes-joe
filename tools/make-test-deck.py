# Builds "test_decks/Clean Notes Joe Test Deck.pptx": 10 slides whose notes cover the cases worth
# checking before a show (needs python-pptx: pip install python-pptx). Run from the project folder.
from pptx import Presentation
from pptx.util import Pt, Inches
from pptx.dml.color import RGBColor

LOREM = ("Talk through each region and what drove the change. Pause on the chart, let the room read it, "
         "then pick out the one number that matters. Mention the team by name. ")

SLIDES = [
    ("1. Welcome",
     "Very short notes: should be big, auto-fit to the max size.",
     ["Good evening, everyone."]),
    ("2. Agenda",
     "A few short lines: each is its own paragraph.",
     ["Three things tonight:", "1. Where we are", "2. What changed", "3. What's next", "Questions at the end."]),
    ("3. No notes",
     "This slide has no speaker notes: the output shows the empty text.",
     None),
    ("4. One paragraph",
     "A single medium paragraph: should fit on screen without scrolling.",
     ["Last year we set out to make the show easier to run. We cut the setup time in half, moved every cue "
      "into one place, and trained four new operators. Tonight is the first show run entirely on the new system."]),
    ("5. Long notes (scrolls)",
     "Too long to fit even at the minimum size: auto-scroll starts after the start delay.",
     [LOREM * 4, LOREM * 4, "Before moving on: " + LOREM * 3, "Last point: " + LOREM * 3]),
    ("6. Very long notes",
     "A full script: tests long scrolling, pause, TOP and dragging the scroll bar.",
     [f"Paragraph {i}. " + LOREM * 2 for i in range(1, 13)]),
    ("7. Line breaks and blank lines",
     "Soft line breaks inside a paragraph, and empty paragraphs between sections.",
     ["Opening line\vsecond line of the same paragraph\vthird line", "", "",
      "After two empty paragraphs", "", "Final line"]),
    ("8. Hidden slide",
     "Hidden in PowerPoint: marked HIDDEN in the slide list (the slideshow skips it).",
     ["These notes belong to a hidden slide."]),
    ("9. Special characters",
     "Accents, quotes, symbols, other scripts and a very long word.",
     ["Café, naïve, Zürich, São Paulo — “curly quotes” and ‘single’ ones.",
      "Symbols: & < > © ® ™ € £ ¥ ✓ ★ → ½",
      "Other scripts: 日本語のテキスト · Ελληνικά · Русский · العربية",
      "A long address that has to wrap: https://example.com/a/very/long/path/that/keeps/going/and/going/without/any/spaces/at/all"]),
    ("10. Thank you",
     "Last slide: NEXT is disabled here. All caps notes test the UPPERCASE setting.",
     ["THANK YOU!", "OPEN THE FLOOR FOR QUESTIONS."]),
]

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
layout = prs.slide_layouts[1]
for i, (title, what, notes) in enumerate(SLIDES):
    s = prs.slides.add_slide(layout)
    s.shapes.title.text = title
    body = s.placeholders[1].text_frame
    body.text = "Tests: " + what
    words = sum(len(p.split()) for p in notes) if notes else 0
    body.add_paragraph().text = f"Notes: {words} words" if notes else "Notes: none"
    for p in body.paragraphs:
        for r in p.runs:
            r.font.size = Pt(28)
    if notes is not None:
        tf = s.notes_slide.notes_text_frame
        first = True
        for para in notes:
            p = tf.paragraphs[0] if first else tf.add_paragraph()
            first = False
            parts = para.split("\v")
            p.text = parts[0]
            for extra in parts[1:]:
                p.add_line_break()
                p.add_run().text = extra
    if title.startswith("8."):
        s._element.set("show", "0")

prs.save("test_decks/Clean Notes Joe Test Deck.pptx")
print("wrote test_decks/Clean Notes Joe Test Deck.pptx")
