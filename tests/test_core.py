import io
from datetime import date

import xlwt

from laimex import discover, registry, rules, validate

VID_HTML = """<html><body><main>
<a href="/lv/media/33944/download?attachment">Kas jāņem vērā konkursu rīkotājiem?</a>
<a href="/lv/media/34040/download?attachment">Izsniegtās preču un pakalpojumu loteriju atļaujas</a>
</main></body></html>"""


def make_xls(rows):
    wb = xlwt.Workbook()
    sh = wb.add_sheet("Atlaujas")
    for c, h in enumerate(registry.HEADERS.values()):
        sh.write(0, c, h)
    for r, row in enumerate(rows, 1):
        for c, v in enumerate(row):
            sh.write(r, c, v)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


ROWS = [
    ["9158", "SIA „Visas Loterijas”", "40103404235", "jebkuriem 2 (diviem) „Haribo” produktiem",
     "“Haribo loterija” ", "15.10.2026.", "16.11.2026.", "jebkura tirdzniecības vieta"],
    ["9191", "SIA “KUMA”", "50003248591", "Žurnālam “Super Kuma”", "I pusgada balva",
     "02.02.2027.", "23.07.2027.", "Latvijas Republika"],
    ["9089", "AAS “BALTA”", "40003049409", "BALTA abonētās polises apdrošināšanas līguma noslēgšanas",
     "Drošība", "01.08.2026.", "28.01.2027.", "Latvijas Republika"],
    ["6204", "SIA X", "1", "pirkums", "Veca", "07.04.2020", "07.05.2020", "LV"],
]


# кусок настоящей страницы VID (копия web.archive.org от 02.04.2026)
VID_REAL = """<div class="file-link-wrap"><div class="file-links">
<span class="visually-hidden">Lejupielādēt: </span>
<a href="/lv/media/34040/download?attachment" type="application/vnd.ms-excel; length=842240"
 title="Loteriju_reģistrs_25.03.2026..xls" class="file" rel="nofollow" data-media="34040"
 aria-label="XLS datne - Izsniegtās preču un pakalpojumu loteriju atļaujas">Izsniegtās preču un pakalpojumu loteriju atļaujas</a>
<span class="tooltip-wrapper media-tooltip"><div class="c_tooltip "><div class="c_tooltip-text " role="tooltip" hidden="">
<div class="c_tooltip-text__content">
      Pievienots: 26.03.2026
    </div></div></div></span></div></div>"""


def test_registry_version_from_page():
    url, version = registry.find_registry_link(VID_REAL, "https://www.vid.gov.lv/lv/loterijas")
    assert url == "https://www.vid.gov.lv/lv/media/34040/download?attachment"
    assert version == "Loteriju_reģistrs_25.03.2026..xls | 842240 | 26.03.2026"


def test_find_registry_url():
    url = registry.find_registry_url(VID_HTML, "https://www.vid.gov.lv/lv/loterijas")
    assert url == "https://www.vid.gov.lv/lv/media/34040/download?attachment"


def test_parse_and_filter():
    rows = registry.parse_xls(make_xls(ROWS))
    assert len(rows) == 4
    assert rows[0]["name"] == "Haribo loterija"
    assert rows[0]["start"] == "2026-10-15" and rows[0]["end"] == "2026-11-16"
    assert rows[0]["place"] == "jebkura tirdzniecības vieta"  # не путать с названием
    rel = registry.relevant(rows, date(2026, 10, 19), 30)
    cats = {r["permit"]: r["category"] for r in rel}
    assert cats == {"9158": "shop", "9089": "service"}  # журнал и старая отброшены


LOTERIJAS_PAGE = """<html><body><main>
<div class="container lottery-cover"><div class="wrapper"><img class="placeholder" src="data:image/png;base64,iVBO">
<img class="cover"
 src="https://www.loterijas.lv/wp-content/uploads/2026/09/haribo-1200x420.jpg" alt=""></div></div>
<h1>Haribo loterija</h1>
<div class="details"><p>Atļaujas Nr. <strong>9158</strong></p>
<p>Skatīt <a class="get-terms" href="https://www.loterijas.lv/loterija/haribo-loterija-2/noteikumi/">noteikumus</a></p></div>
<form class="ui-form lottery-registration"><input name="ReceiptUnique"></form>
<a class="get-terms" href="">Noteikumiem</a></main></body></html>"""


def test_loterijas_lv_page():
    info = discover.parse_loterijas_lv_page(LOTERIJAS_PAGE, "https://www.loterijas.lv/loterija/haribo-loterija-2/")
    assert info["permit"] == "9158"
    assert info["rules"].endswith("/noteikumi/")
    assert info["registration"] == "https://www.loterijas.lv/loterija/haribo-loterija-2/"
    assert info["banner_src"] == "https://www.loterijas.lv/wp-content/uploads/2026/09/haribo-1200x420.jpg"


def test_loterijas_lv_index_skips_rules():
    html = '<a href="/loterija/a/">A</a><a href="/loterija/a/noteikumi/">r</a><a href="/loterija/b/#x">B</a>'
    assert discover.parse_loterijas_lv_index(html) == [
        "https://www.loterijas.lv/loterija/a/", "https://www.loterijas.lv/loterija/b/"]


def test_loterijatev():
    html = """<a href="https://roshenloterija.lv/" class="item"><div class="txt">
    <h4>Roshen rudens loterija 2026</h4><span>19.10.-29.11.2026.</span>Loterijas atļaujas Nr. 9174.</div></a>"""
    out = discover.parse_loterijatev(html)
    assert out == [{"permit": "9174", "page": "https://roshenloterija.lv/",
                    "title": "Roshen rudens loterija 2026", "found_by": "loterijatev.lv"}]


def test_find_rules_link_prefers_pdf_over_anchor_and_privacy():
    html = """<a href="#noteikumi">Noteikumi</a>
    <a href="/privatuma-politika.pdf">Privātuma politika</a>
    <a href="assets26/WEB_Noteikumi_E-Rimi_oktobris.pdf">Pilni loterijas noteikumi</a>"""
    link = discover.find_rules_link(html, "https://www.rimiloterija.lv/oktobris/")
    assert link == "https://www.rimiloterija.lv/oktobris/assets26/WEB_Noteikumi_E-Rimi_oktobris.pdf"


def test_html_rules_text_keeps_tables():
    html = """<html><body><nav>menu</nav><main><h1>Noteikumi</h1>
    <table><tr><td>Televizors</td><td>1</td><td>763.99</td></tr></table></main></body></html>"""
    text = rules.html_to_text(html)
    assert "Televizors | 1 | 763.99" in text and "menu" not in text


FANTA = {
    "permit": None, "lottery_start": "2026-04-27", "lottery_end": "2026-07-06",
    "registration_start": "2026-04-27", "registration_end": "2026-06-30",
    "prizes": [
        {"name": "Наушники", "qty": 10, "unit_value_eur": 459.20, "total_value_eur": 4592},
        {"name": "Game Pass", "qty": 81, "unit_value_eur": 14.99, "total_value_eur": 1214.19},
    ],
    "prize_fund_eur": 5806.19,
    "draws": [{"date": "2026-05-12", "prizes": [{"name": "Наушники", "qty": 10}, {"name": "Game Pass", "qty": 81}]}],
}
REG = {"permit": "9001", "start": "2026-04-27", "end": "2026-07-06"}


def test_validate_good():
    checks = validate.check(FANTA, REG)
    assert all(c["ok"] for c in checks), checks
    assert validate.status(checks) == "ok"


def test_validate_catches_wrong_fund_and_dates():
    bad = dict(FANTA, prize_fund_eur=6000, lottery_end="2026-07-10")
    checks = validate.check(bad, REG)
    assert validate.status(checks) == "needs_review"
    assert sum(not c["ok"] for c in checks) == 2
