"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const PAGES = ["home", "mine", "bot", "install", "about", "bug"];
const PAGE_TITLE = { mine: "Мои лотереи", bot: "Telegram-бот", install: "Как установить", about: "О сайте",
  bug: "Сообщить об ошибке" };
const TABS = ["past", "now", "soon"];
const SORTS = [["days", "Скоро конец"], ["fund", "Больше фонд"], ["odds", "Лучше шансы"],
  ["spend", "Меньше тратить"], ["new", "Новые"]];
const TYPES = ["Еда", "Напитки", "Сладости", "Красота и уход", "Здоровье", "Для дома", "Любая покупка", "Услуги", "Другое"];
const THEMES = ["auto", "light", "dark"];
const THEME_LABEL = { auto: "как в системе", light: "светлая", dark: "тёмная" };
const BASE_TITLE = document.title;

const state = { page: "home", sel: null, tab: "now", q: "", sort: "days", stores: new Set(), types: new Set(),
  fav: new Set(), theme: "auto", layer: null, items: [], data: null, today: rigaToday() };

// ---------------------------------------------------------------- хранилище

// Всё, что помним между заходами; без хранилища (приватный режим) сайт просто не помнит.
function readStore(key, fallback, store = localStorage) {
  try { const v = store.getItem(key); return v == null ? fallback : JSON.parse(v); }
  catch (e) { return fallback; }
}
function writeStore(key, value, store = localStorage) {
  try { store.setItem(key, JSON.stringify(value)); } catch (e) { /* без хранилища */ }
}
function savePrefs() {
  writeStore("prefs", { tab: state.tab, sort: state.sort, stores: [...state.stores], types: [...state.types] });
}
function saveFav() { writeStore("fav", [...state.fav]); }
(function restore() {
  const p = readStore("prefs", {}) || {};
  if (TABS.includes(p.tab)) state.tab = p.tab;
  const sort = { ending: "days", prize: "fund" }[p.sort] || p.sort;  // названия из прошлой версии
  if (SORTS.some(([id]) => id === sort)) state.sort = sort;
  if (Array.isArray(p.stores)) state.stores = new Set(p.stores.filter(s => typeof s === "string"));
  if (Array.isArray(p.types)) state.types = new Set(p.types.filter(t => TYPES.includes(t)));
  const fav = readStore("fav", []);
  if (Array.isArray(fav)) state.fav = new Set(fav.map(String));
  const theme = readStore("theme", "auto");
  if (THEMES.includes(theme)) state.theme = theme;
})();

// ---------------------------------------------------------------- даты и текст

function rigaToday() {
  // YYYY-MM-DD в часовом поясе Риги
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Riga" }).format(new Date());
}
const dayMs = 86400000;
function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / dayMs); }
function fmtDate(iso, withYear) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  const thisYear = state.today.slice(0, 4);
  return withYear || y !== thisYear ? `${d}.${m}.${y}` : `${d}.${m}`;
}
function fmtRange(a, b) { return a && b ? `${fmtDate(a)}–${fmtDate(b)}` : "—"; }
function weekday(iso, form) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("ru-RU", { weekday: form, timeZone: "UTC" });
}
function money(n, whole) {
  if (n == null) return "";
  const round = whole || Math.abs(n - Math.round(n)) < 0.005;
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "EUR",
    minimumFractionDigits: round ? 0 : 2, maximumFractionDigits: round ? 0 : 2 }).format(n);
}
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
function dayWord(n) { return plural(n, "день", "дня", "дней"); }
function lotteries(n) { return `${n} ${plural(n, "лотерея", "лотереи", "лотерей")}`; }
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== "") e.append(k);
  return e;
}
function icon(name, cls = "ic") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}
// Поиск без учёта регистра и латышской диакритики: ā→a, š→s, ļ→l.
function norm(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, ""); }

// ---------------------------------------------------------------- данные

// Последний день, когда можно купить и зарегистрировать чек.
function regEnd(it) { return it.summary?.registration_end || it.end; }

// soon — ещё не началась; open — можно участвовать; closed — регистрация закончилась,
// но лотерея ещё идёт (ждём розыгрыша); past — завершилась.
function phase(it) {
  if (it.start > state.today) return "soon";
  if (it.end < state.today) return "past";
  if (regEnd(it) < state.today) return "closed";
  return "open";
}
function tabOf(it) { const p = phase(it); return p === "open" || p === "closed" ? "now" : p; }
function nextDraw(it) {
  const draws = it.summary?.draws || [];
  return draws.map(d => d.date).filter(d => d && d >= state.today).sort()[0] || null;
}
function mainPrize(s) {
  if (!s?.prizes?.length) return null;
  return [...s.prizes].sort((a, b) => (b.unit_value_eur || 0) - (a.unit_value_eur || 0))[0];
}
function titleOf(it) { return it.summary?.title || it.name || it.purchase; }
function haystack(it) {
  const s = it.summary || {};
  return norm([it.name, it.organizer, it.purchase, it.place, s.title, s.sponsor, s.what_to_buy, s.buy_short,
    s.where, ...(s.prizes || []).map(p => p.name), ...it._types, it._brand.name].join(" "));
}

// Торговые сети: ищем название в «где покупать» (реестр и выжимка). Оговорки вроде
// «(izņemot veikalu Rimi)» / «(кроме магазина Rimi)» не считаются.
const STORES = [
  ["Maxima", "maxima|barbora"], ["Rimi"], ["Lidl"], ["Top!", "top"], ["Elvi"], ["Mego"], ["Vesko"], ["Spar"],
  ["Aibe"], ["LaTS", "lats|e-latts"], ["Citro"], ["Eldo"], ["Drogas"], ["Apotheka"], ["Benu"], ["Mēness aptieka"],
  ["Euroaptieka"], ["Stenders"], ["Depo"], ["Narvesen"], ["Circle K"], ["Virši"], ["Pepco"],
].map(([name, words]) => [name, new RegExp(`(^|[^\\p{L}])(${words || norm(name)})(?!\\p{L})`, "u")]);
function whereText(it) {
  return norm(`${it.place || ""} ${it.summary?.where || ""}`).replace(/\(?\s*(izn?emot|кроме)[^),.;]*\)?/gu, " ");
}
function storesOf(it) { const w = whereText(it); return STORES.filter(([, re]) => re.test(w)).map(([name]) => name); }
// Лотерея «в любом магазине Латвии» подходит под фильтр любой сети.
function anyStore(it) {
  if (it._stores.length) return false;
  const w = whereText(it);
  return /latvijas republik|по всей латвии|любой магазин|любые|jebkur|розничные магазины/.test(w)
    && !/aptiek|аптек|centr|тц|dambja|vietne|онлайн|sporta|спорт|tele2/.test(w);
}

// Тип товара по названию лотереи и условию покупки.
const TYPE_WORDS = [
  ["Еда", /maiz|хлеб|fazer|kaija|тунц|tunc|cips|чипс|pringles|doritos|kellogg|philadelphia|сыр|siers|колбас|zigmas|dziugas|pik nik/],
  ["Напитки", /coca|fanta|sprite|schweppes|kafij|кофе|paulig|merrild|dallmayr|birute|vanden|mineral|напит|dzerien|сок|sula|alus|пиво|teja|чай|fuzetea|nabeghlavi|pepsi/],
  ["Сладости", /haribo|m&m|maltesers|skittles|orbit|hubba|жвач|kosl|kinder|bueno|lacmi|roshen|selga|ferrero|nutella|конфет|шокол|sokol|торт|kuku|kukas|рулет|пирожн|staburadz|magija|сладост|saldum|cepum|печень|snickers|oreo|twix|karl fazer/],
  ["Красота и уход", /filorga|pharmaceris|косметик|kosmetik|henkel|schwarzkopf|garnier|old spice|gillette|pampers|higien|nivea/],
  ["Здоровье", /moller|витамин|vitamin|haleon|apotheka/],
  ["Для дома", /pink stuff|somat|duracell|grite|kh-7|candy|haier|техник|tehnik|бытов/],
];
function typesOf(it) {
  const s = it.summary || {};
  if (it.category === "service") return ["Услуги"];
  // what_to_buy не берём: там списки исключений вроде «кроме алкоголя (включая пиво)»
  const t = norm([it.name, it.purchase, s.title, s.sponsor, s.buy_short].join(" "));
  if (/maksker|рыболов/.test(t)) return ["Услуги"];
  const out = TYPE_WORDS.filter(([, re]) => re.test(t)).map(([name]) => name);
  if (!out.length && (s.min_purchase_eur != null || /vismaz\s*\d+([.,]\d+)?\s*eur|покупка от/.test(t))) out.push("Любая покупка");
  return out.length ? out : ["Другое"];
}

// Логотипы брендов для своего баннера (web/brands/). У кого логотипа нет, название набирается шрифтом.
const LOGOS = {
  "Coca-Cola": "coca-cola.png", "Fanta": "fanta.png", "Sprite": "sprite.png", "Schweppes": "schweppes.png",
  "Fuzetea": "fuzetea.png", "Kinder": "kinder.png", "Nutella": "nutella.png", "OREO": "oreo.png", "Kellogg's": "kelloggs.png",
  "Colgate": "colgate.png", "Palmolive": "palmolive.png", "Speed Stick": "speed-stick.png", "Garnier": "garnier.png",
  "Henkel": "henkel.png", "Old Spice": "old-spice.png", "Gillette": "gillette.png", "Duracell": "duracell.png",
  "Haier": "haier.png", "Tele2": "tele2.png", "Swedbank": "swedbank.png", "Luminor": "luminor.png", "Maxima": "maxima.png",
};
// Бренд для значка: ищем известное название в условии покупки, затем в названии лотереи.
const BRANDS = [
  ["Coca-Cola", "coca-cola|coca cola", "#E41E2B", "CC"], ["Fanta", "fanta", "#F57C00"], ["Sprite", "sprite", "#00843D"],
  ["Schweppes", "schweppes", "#F2C14E"], ["Paulig", "paulig", "#1F4E8C"], ["Merrild", "merrild", "#7A1E2B"],
  ["Dallmayr", "dallmayr", "#8B6B2E"], ["Birute", "birute", "#0A6CB0"], ["Haribo", "haribo", "#F2B700"],
  ["M&M’s", "m&m", "#6B3A1F", "M&M"], ["Orbit", "orbit|hubba", "#0A5CA8"], ["Kinder", "kinder|bueno", "#E2001A"],
  ["Lacmi", "lacmi|roshen", "#6B2C91", "Ro"], ["Selga", "selga", "#C8102E"], ["Ferrero", "ferrero", "#8A5F00"],
  ["Nutella", "nutella", "#5C3317"], ["Staburadze", "staburadz", "#A0522D"], ["Magija", "magija", "#D6336C"],
  ["Latvijas Maiznieks", "latvijas maiznieks|graudu maize", "#A0522D", "LM"], ["Fazer", "fazer", "#1F4E8C"],
  ["Kaija", "kaija", "#0A6CB0"], ["Ādažu", "adazu", "#C24E00", "ĀČ"], ["Pringles", "pringles", "#C8102E"],
  ["Philadelphia", "philadelphia", "#1F4E8C"], ["Grite", "grite", "#2E8B57"], ["Möller’s", "moller", "#0A6CB0"],
  ["Filorga", "filorga", "#33415C"], ["Pharmaceris", "pharmaceris", "#2E6B30"], ["The Pink Stuff", "pink stuff", "#D6336C", "PS"],
  ["Somat", "somat", "#0A5CA8"], ["Duracell", "duracell", "#8A5F00"], ["Candy", "candy", "#C8102E"], ["Haier", "haier", "#0A5CA8"],
  ["MyFitness", "myfitness|my fitness", "#E30613", "MF"], ["Tele2", "tele2|zelta zivtin", "#33415C", "T2"],
  ["Luminor", "luminor", "#6B2C91"], ["BALTA", "balta", "#C8102E"], ["KH-7", "kh-7", "#2E6B30", "KH"],
  ["Makšķernieku", "maksker", "#0A6CB0", "Mk"], ["VIVO", "vivo", "#6B2C91"], ["Ostmala", "ostmala", "#1F4E8C"],
  ["Mego", "mego", "#E30613"], ["Rimi", "rimi", "#C8102E"], ["Maxima", "maxima|barbora", "#C8102E", "Mx"],
  ["top!", "top", "#E30613", "top"], ["LaTS", "lats", "#E30613"], ["Citro", "citro", "#F57C00"], ["Elvi", "elvi", "#E30613"],
  ["Eldo", "eldo", "#1F4E8C"], ["Colgate", "colgate", "#C8102E"], ["Palmolive", "palmolive", "#0B7A53"],
  ["Speed Stick", "speed stick", "#33415C", "SS"], ["Garnier", "garnier", "#2E6B30"], ["Henkel", "henkel", "#C8102E"],
  ["Schwarzkopf", "schwarzkopf", "#33415C"], ["Sensodyne", "sensodyne", "#1F4E8C"], ["Parodontax", "parodontax", "#2E6B30"],
  ["Aquafresh", "aquafresh", "#0A6CB0"], ["Corega", "corega", "#0A6CB0"], ["Old Spice", "old spice", "#B0182E", "OS"],
  ["Gillette", "gillette", "#1F4E8C"], ["Always", "always", "#6B2C91"], ["Naturella", "naturella", "#2E8B57"],
  ["Discreet", "discreet", "#B0306A"], ["Tampax", "tampax", "#1F4E8C"], ["Pampers", "pampers", "#0A7C86"],
  ["Stenders", "stenders", "#8A5F00"], ["Fuzetea", "fuzetea", "#0B7A53"], ["Swedbank", "swedbank", "#C24E00"],
  ["LMT", "lmt", "#6B2C91"], ["Džiugas", "dziugas", "#C8102E"], ["PIK NIK", "pik nik", "#C24E00", "PN"],
  ["Nabeghlavi", "nabeghlavi", "#0A6CB0"], ["Zigmas", "zigmas", "#0A6CB0"], ["Doritos", "doritos", "#C8102E"],
  ["Kellogg's", "kellogg", "#C8102E", "K"], ["OREO", "oreo", "#1F4E8C"], ["Super Manki", "super manki", "#C24E00", "SM"],
  ["Via Jurmala", "via jurmala", "#33415C", "VJ"], ["Einšteins", "einsteins", "#1F4E8C"],
].map(([name, words, tint, mono]) => ({ name, re: new RegExp(`(^|[^\\p{L}])(${words})`, "u"), tint, mono, logo: LOGOS[name] }));
const TINTS = ["#C8102E", "#1F4E8C", "#C24E00", "#6B2C91", "#0A6CB0", "#0B7A53", "#B0306A", "#2E6B30", "#8A5F00"];
const STOP = /^(loterija|svini|izbaudi|ar|perc|spele|laime|pievienojiet|ziemassvetki|drosiba|vislatvijas|kas|un|the|la)$/;
function brandOf(it) {
  const texts = [it.purchase, it.name, it.summary?.buy_short, it.place, it.organizer].map(norm);
  for (const t of texts) {
    let best = null, at = Infinity;
    for (const b of BRANDS) {
      const m = b.re.exec(t);
      if (m && m.index < at) { best = b; at = m.index; }
    }
    if (best) return paint(best.name, best.mono || monogram(best.name), best.tint);
  }
  const word = (titleOf(it) || "?").split(/[\s"„“”«»'’!.,:;+=()-]+/).find(w => w.length > 1 && !STOP.test(norm(w))) || "?";
  let h = 0;
  for (const ch of word) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return paint(word, monogram(word), TINTS[h % TINTS.length]);
}
function monogram(name) {
  const words = name.split(/[\s-]+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  return name[0].toUpperCase() + (name[1] || "").toLowerCase();
}
function paint(name, mono, tint) {
  const light = ["#F2B700", "#F2C14E"].includes(tint);
  return { name, mono, tint, ink: light ? "#1A1400" : "#FFFFFF" };
}

// ---------------------------------------------------------------- картинка билета

// Значки по типу товара (рисунок 32×32, линии цветом текста). Тот же значок идёт в кружок
// на билете и узором в фон своего баннера, если у лотереи нет баннера организатора.
const ART = {
  coffee: '<path d="M6 13h17v6a7 7 0 0 1-7 7h-3a7 7 0 0 1-7-7z"/><path d="M23 15h1.5a3 3 0 0 1 0 6H22M11 4c-1.2 1.5 1.2 2.5 0 4M16 4c-1.2 1.5 1.2 2.5 0 4M4 29h21"/>',
  drink: '<path d="M8 10h16l-2 18a2 2 0 0 1-2 1.8h-8A2 2 0 0 1 10 28z"/><path d="M9 16h14M17 10l3-7h4"/><circle cx="14" cy="21" r="1"/><circle cx="18" cy="24.5" r="1"/>',
  bear: '<g fill="currentColor" stroke="none"><circle cx="10.5" cy="6.5" r="3"/><circle cx="21.5" cy="6.5" r="3"/><ellipse cx="16" cy="11" rx="7" ry="6"/><ellipse cx="16" cy="21" rx="8" ry="8"/><circle cx="8" cy="17.5" r="2.6"/><circle cx="24" cy="17.5" r="2.6"/><circle cx="10.5" cy="27" r="3"/><circle cx="21.5" cy="27" r="3"/></g>',
  candy: '<circle cx="16" cy="16" r="6.5"/><path d="M10.2 13L3.5 9.5v13l6.7-3.5M21.8 13l6.7-3.5v13l-6.7-3.5M13 12.5c2.5 1.5 4.5 4 5.5 6.5"/>',
  chocolate: '<path d="M9 14V5a1.5 1.5 0 0 1 1.5-1.5h11A1.5 1.5 0 0 1 23 5v9M9 9h14M16 3.5V14"/><path d="M7.5 14h17v13.5a1.5 1.5 0 0 1-1.5 1.5H9a1.5 1.5 0 0 1-1.5-1.5zM7.5 17l3-2.5 3 2.5 3-2.5 3 2.5 3-2.5 2 2"/>',
  cookie: '<circle cx="16" cy="16" r="12"/><g fill="currentColor" stroke="none"><circle cx="11" cy="12" r="1.6"/><circle cx="19.5" cy="10.5" r="1.6"/><circle cx="20.5" cy="19.5" r="1.6"/><circle cx="12" cy="20.5" r="1.6"/><circle cx="16" cy="15.5" r="1.2"/></g>',
  cake: '<path d="M4 15L26 8v18H4z"/><path d="M4 20.5h22M4 15c3 2 6 0 9 1.5s6-.5 9 .5 4-1 4-2M19.5 10V5"/><circle cx="19.5" cy="3.2" r=".8" fill="currentColor"/>',
  gum: '<circle cx="16" cy="14" r="10"/><path d="M10.5 11a6 6 0 0 1 4.5-4M11.5 27c2-2.2 7-2.2 9 0"/>',
  cheese: '<path d="M4 23v-9L21 6l7 8v9z"/><path d="M4 14h24"/><circle cx="11" cy="18.5" r="1.8"/><circle cx="20" cy="19" r="1.3"/>',
  chips: '<path d="M8 4h16l-1.5 3 1.5 3v12l-1.5 3 1.5 3H8l1.5-3L8 22V10l1.5-3z"/><path d="M12.5 15.5l3.5-3 4 2.5-3.5 3.5z"/>',
  bread: '<path d="M6 14.5A5.5 5.5 0 0 1 10 5h12a5.5 5.5 0 0 1 4 9.5V26a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 6 26z"/><path d="M11.5 11l2 3M16 10l2 3M20.5 11l1.5 2.5"/>',
  fish: '<path d="M3 16c4-6 11-8 17-4 2 1.4 3.5 2.6 4.5 4-1 1.4-2.5 2.6-4.5 4-6 4-13 2-17-4z"/><path d="M24.5 16L29 11v10z"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/>',
  cereal: '<path d="M4 15h24a12 12 0 0 1-24 0z"/><path d="M10 27h12"/><circle cx="11" cy="11" r="1.8"/><circle cx="16" cy="9" r="1.8"/><circle cx="21" cy="11" r="1.8"/>',
  food: '<circle cx="16" cy="16" r="7.5"/><path d="M3.5 5v6a2 2 0 0 0 4 0V5M5.5 11v16M27.5 5c-2 2-2.5 6-2 10h2v12"/>',
  tooth: '<path d="M16 7.5c-2-2-6-3-8.5-.5S5 14 7 18c1 2 1 9 3.5 9s2-6 5.5-6 3 6 5.5 6 2.5-7 3.5-9c2-4 3.5-8.5 1-11S18 5.5 16 7.5z"/>',
  razor: '<rect x="6" y="4" width="20" height="8" rx="2"/><path d="M6 8h20M16 12v5"/><rect x="13" y="17" width="6" height="11" rx="3"/>',
  baby: '<circle cx="16" cy="9" r="5"/><path d="M7 17.5c0-2 2.5-3.5 9-3.5s9 1.5 9 3.5-3.5 3.5-9 3.5-9-1.5-9-3.5z"/><circle cx="16" cy="25.5" r="3"/>',
  beauty: '<rect x="5" y="15" width="20" height="13" rx="3"/><rect x="7" y="10" width="16" height="5" rx="1.5"/><path d="M10 21.5h10M26 3v6M23 6h6"/>',
  health: '<path d="M7.5 24.5a5 5 0 0 1 0-7l10-10a5 5 0 0 1 7 7l-10 10a5 5 0 0 1-7 0z"/><path d="M12.5 12.5l7 7"/>',
  dish: '<circle cx="14" cy="18" r="10"/><circle cx="14" cy="18" r="5.5"/><path d="M25 3v6M22 6h6M28.5 13v3M27 14.5h3"/>',
  spray: '<path d="M10 13h9l2 4v10.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 8 27.5V17z"/><path d="M12 13V9h6l3 2h3M12 9L9.5 5H19M27 7v.1M28 12v.1M25.5 3.5v.1"/>',
  paper: '<ellipse cx="10" cy="12" rx="5" ry="7"/><ellipse cx="10" cy="12" rx="1.5" ry="2.2"/><path d="M10 5h13c2.8 0 5 3.1 5 7v15H15V19"/>',
  home: '<path d="M4 15L16 5l12 10M7 13v14h18V13M13 27v-7h6v7"/>',
  battery: '<rect x="9" y="6" width="14" height="23" rx="2"/><path d="M13 3h6v3M17 11l-4 6h6l-4 6"/>',
  appliance: '<rect x="6" y="3.5" width="20" height="25" rx="2.5"/><path d="M6 9.5h20M12.5 19.5c1.5-1 2.5 1 3.5 0s2.5-1 3.5 0"/><circle cx="16" cy="19" r="6"/>',
  phone: '<rect x="10" y="3" width="12" height="26" rx="3"/><path d="M14.5 25h3M5.5 11a9 9 0 0 0 0 10M26.5 11a9 9 0 0 1 0 10"/>',
  card: '<rect x="3.5" y="7" width="25" height="18" rx="3"/><path d="M3.5 12.5h25M8 19.5h6"/>',
  shield: '<path d="M16 3.5l10 4v8c0 6-4.2 10.6-10 13-5.8-2.4-10-7-10-13v-8z"/><path d="M11.5 16l3 3 6-6"/>',
  dumbbell: '<path d="M10 16h12M2.5 13v6M29.5 13v6"/><rect x="5" y="9" width="5" height="14" rx="1.5"/><rect x="22" y="9" width="5" height="14" rx="1.5"/>',
  car: '<path d="M4 22v-6l3.5-6.5h17L28 16v6z"/><path d="M4 16h24"/><circle cx="9.5" cy="22.5" r="2.8"/><circle cx="22.5" cy="22.5" r="2.8"/>',
  bag: '<path d="M6 10h20l-1.5 18h-17z"/><path d="M11.5 13V8a4.5 4.5 0 0 1 9 0v5"/>',
  ticket: '<path d="M4 9h24v4.5a2.5 2.5 0 0 0 0 5V23H4v-4.5a2.5 2.5 0 0 0 0-5z"/><path d="M20 9v14" stroke-dasharray="2.5 2.5"/>',
};
// Значок по словам в условии покупки и названии; первый подошедший. Если ничего не нашлось,
// берём значок по типу товара.
const KINDS = [
  ["car", /transportlidzekl|vaditaj|autoskol/], ["fish", /maksker|zivs|tunc|тунц|kaija|zigmas|loms/],
  ["phone", /tele2|lmt|zelta zivtin|tarif/], ["card", /swedbank|luminor|banka/], ["shield", /balta|apdrosin|polis/],
  ["dumbbell", /myfitness|my fitness|fitnes/], ["coffee", /kafij|кофе|paulig|merrild|dallmayr|jacobs|nescafe/],
  ["chips", /cips|чипс|pringles|doritos|adazu/],
  ["drink", /coca|fanta|sprite|schweppes|fuzetea|nabeghlavi|birute|mineral|(^|\s)(udens|sula|teja|alus|сок)|напит|dzerien|pepsi|чай|пиво/],
  ["bear", /haribo|zelej|marmelad/], ["gum", /orbit|hubba|kosl|жвач/],
  ["chocolate", /sokol|шокол|snickers|twix|bounty|mars|kinder|bueno|ferrero|nutella|karl fazer|milka/],
  ["cookie", /selga|cepum|печень|oreo/], ["cake", /kuk|торт|рулет|rulet|staburadz|tort/],
  ["candy", /m&m|maltesers|skittles|konfekt|конфет|saldum|lacmi|roshen/],
  ["cheese", /siers|сыр|philadelphia|dziugas|magija|pik nik|biezpien/], ["bread", /maiz|хлеб|graudu/],
  ["cereal", /kellogg|parslas|musli/], ["tooth", /colgate|sensodyne|parodontax|aquafresh|corega|zobu|haleon/],
  ["razor", /gillette|skuv/], ["baby", /pampers|autini/],
  ["beauty", /filorga|pharmaceris|garnier|kosmetik|косметик|stenders|avene|klorane|isdin|bionike|schwarzkopf|henkel|old spice|palmolive|speed stick|always|naturella|tampax|discreet|nivea|higien/],
  ["health", /moller|витамин|vitamin|apotheka|aptiek/], ["dish", /somat|fairy|trauku/],
  ["spray", /pink stuff|kh-7|tirisan/], ["paper", /grite|papir|salvet/], ["battery", /duracell|bateri/],
  ["appliance", /candy|haier|tehnik|техник/],
  ["bag", /vismaz\s*\d|покупка от|rimi|maxima|top!|mego|citro|elvi|lats|vivo|ostmala|outlet/],
];
const TYPE_ART = { "Еда": "food", "Напитки": "drink", "Сладости": "candy", "Красота и уход": "beauty", "Здоровье": "health",
  "Для дома": "home", "Любая покупка": "bag" };
function kindOf(it) {
  const s = it.summary || {};
  const t = norm([it.purchase, it.name, s.title, s.sponsor, s.buy_short].join(" "));
  const hit = KINDS.find(([, re]) => re.test(t));
  if (hit) return hit[0];
  return TYPE_ART[it._types.find(x => TYPE_ART[x])] || "ticket";
}
function art(kind, cls = "art") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = ART[kind];
  return svg;
}
// Узор фона своего баннера: значок, повторённый в шахматном порядке.
const patterns = new Map();
function patternOf(kind) {
  if (!patterns.has(kind)) {
    const g = `fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"`;
    const a = ART[kind].replace(/currentColor/g, "#fff");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">`
      + `<g ${g} opacity=".16" transform="translate(10 12) rotate(-12 16 16)">${a}</g><g ${g} opacity=".16" transform="translate(70 70) rotate(10 16 16)">${a}</g></svg>`;
    patterns.set(kind, `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
  }
  return patterns.get(kind);
}
// Бренды лотереи для своего баннера: известные из условия покупки (с логотипом, если он есть), а если
// таких нет, названия в кавычках оттуда же — «“AVÈNE”, “BABĒ”, “KLORANE”». Не больше четырёх.
function brandsOf(it) {
  const t = norm(it.purchase);
  const out = BRANDS.map(b => ({ b, m: b.re.exec(t) })).filter(x => x.m).sort((x, y) => x.m.index - y.m.index)
    .map(({ b }) => ({ name: b.name, logo: b.logo, tint: b.tint }));
  if (!out.length) {
    for (const m of String(it.purchase || "").matchAll(/[“”"„«]\s*([^“”"„«»,;]{2,24}?)\s*[“”"»]/g)) {
      if (/\p{L}/u.test(m[1]) && !out.some(x => norm(x.name) === norm(m[1]))) out.push({ name: m[1].trim() });
    }
  }
  return out.length ? out.slice(0, 4) : [{ name: it._brand.name, logo: LOGOS[it._brand.name], tint: it._brand.tint }];
}
function heroOf(it) {
  if (it.banner) return el("img", { src: it.banner, alt: "", loading: "lazy", decoding: "async", width: 720, height: 252 });
  const b = it._brand;
  const box = el("span", { class: "made" },
    el("span", { class: "stickers" }, brandsOf(it).map(x => x.logo
      ? el("span", { class: "sticker" }, el("img", { src: `brands/${x.logo}`, alt: x.name, loading: "lazy" }))
      : el("span", { class: "sticker word", style: `color:${inkOn(x.tint || b.tint)}` }, x.name))),
    art(it._kind, "art big"));
  box.style.backgroundImage = patternOf(it._kind);
  return box;
}
// Название бренда на белой наклейке: светлые фирменные цвета не читаются, берём тёмный.
function inkOn(tint) { return ["#F2B700", "#F2C14E", "#F57C00"].includes(tint) ? "#1A1400" : tint; }

// Шансы в правилах записаны по-разному: «121 к 10000», «41 из 20 000», «2:5000», «53/2000».
// Приводим к «1 к N».
function oddsOf(it) {
  const s = it.summary?.odds;
  if (!s) return null;
  const nums = [...String(s).matchAll(/\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+/g)].map(m => Number(m[0].replace(/\D/g, "")));
  if (nums.length < 2 || !nums[0] || !nums[1]) return null;
  const r = nums[1] / nums[0];
  return r >= 1 ? r : null;
}
// Сколько потратить: минимальная сумма покупки, иначе число товаров в одном чеке
// (грубая оценка «товар ≈ 1 €», чтобы лотереи с одним товаром шли первыми).
function spendOf(it) {
  if (it.category === "service") return null;
  const s = it.summary, p = norm(it.purchase);
  if (s?.min_purchase_eur != null) return s.min_purchase_eur;
  const sum = p.match(/vismaz\s*(\d+(?:[.,]\d+)?)\s*eur/);
  if (sum) return parseFloat(sum[1].replace(",", "."));
  const n = (s?.buy_short || "").match(/^(\d+)\s/);
  if (n) return Number(n[1]);
  if (/(^|\s)(diviem|divu|2)(\s|$)/.test(p)) return 2;
  if (/(^|\s)(trim|tris|3)(\s|$)/.test(p)) return 3;
  return 1;
}
function isNew(it) {
  const n = daysBetween(it.start, state.today);
  return n >= 0 && n < 7;
}

// Короткая строка «что купить»: из выжимки, иначе обрезаем полную.
function shortBuy(it) {
  const s = it.summary;
  if (s?.buy_short) return s.buy_short;
  const full = s?.what_to_buy || it.purchase || "";
  const cut = full.split(/;|\(| — /)[0].trim();
  return cut.length > 110 ? cut.slice(0, 105).replace(/\s+\S*$/, "") + "…" : cut;
}
// Короткое имя для строки «ближайший розыгрыш».
function shortName(it) {
  const t = titleOf(it).replace(/\s*(rudens|ziemas|vasaras|pavasara)?\s*loterij\w*.*$/i, "").split(/\s=\s|!/)[0].trim();
  return t && t.length <= 22 ? t : it._brand.name;
}

// ---------------------------------------------------------------- список

function sorter(tab) {
  const soonest = (a, b) => {
    const pa = phase(a);
    if (pa !== phase(b)) return 0;
    if (pa === "past") return b.end.localeCompare(a.end);
    if (pa === "soon") return a.start.localeCompare(b.start);
    if (pa === "open") return regEnd(a).localeCompare(regEnd(b));
    return a.end.localeCompare(b.end);
  };
  const known = (x, y, f) => x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : f(x, y);
  const by = {
    days: soonest,
    fund: (a, b) => known(a._fund, b._fund, (x, y) => y - x) || soonest(a, b),
    odds: (a, b) => known(a._odds, b._odds, (x, y) => x - y) || soonest(a, b),
    spend: (a, b) => known(a._spend, b._spend, (x, y) => x - y) || soonest(a, b),
    new: (a, b) => b.start.localeCompare(a.start) || b.permit.localeCompare(a.permit),
  }[state.sort];
  // на «Актуальных» закрытые для чеков всегда ниже; в моих — по фазам
  const rank = tab === "mine" ? { open: 0, closed: 1, soon: 2, past: 3 } : { open: 0, closed: 1, soon: 0, past: 0 };
  return (a, b) => rank[phase(a)] - rank[phase(b)] || by(a, b) || a.permit.localeCompare(b.permit);
}

// Лотереи вкладки с поиском и фильтрами. Лотереи за услуги видны, только если выбран тип
// «Услуги» или что-то ищут.
function filtered(tab) {
  const q = norm(state.q.trim());
  return state.items.filter(it => {
    if (tabOf(it) !== tab) return false;
    if (q && !it._hay.includes(q)) return false;
    if (state.types.size ? !it._types.some(t => state.types.has(t)) : (it.category === "service" && !q)) return false;
    if (state.stores.size && !it._any && !it._stores.some(s => state.stores.has(s))) return false;
    return true;
  });
}
function visible() { return filtered(state.tab).sort(sorter(state.tab)); }

// ---------------------------------------------------------------- карточка

// Что написано на корешке билета.
function stub(it) {
  const p = phase(it);
  const service = it.category === "service";
  if (p === "open") {
    const n = daysBetween(state.today, regEnd(it));
    const sub = `до ${fmtDate(regEnd(it))}`;
    if (n === 0) return { num: "0", word: "последний", l2: "день", sub, urgent: true };
    return { num: String(n), word: dayWord(n), l2: service ? "на участие" : "на чек", sub, urgent: n <= 7,
      long: `${dayWord(n)} ${service ? "на участие" : "на регистрацию"}` };
  }
  if (p === "closed") {
    const nd = nextDraw(it);
    if (!nd) return { num: "✓", word: "приём", l2: "закрыт", sub: `итоги до ${fmtDate(it.end)}` };
    const n = daysBetween(state.today, nd);
    if (n === 0) return { num: "сегодня", small: true, word: "розыгрыш", l2: "", sub: "чеки не принимают" };
    return { num: String(n), word: `${dayWord(n)} до`, l2: "розыгрыша", sub: "чеки не принимают" };
  }
  if (p === "soon") {
    const n = daysBetween(state.today, it.start);
    return { num: String(n), word: dayWord(n), l2: "до старта", sub: `с ${fmtDate(it.start)}` };
  }
  return { num: fmtDate(it.end), small: true, word: "завершилась", l2: "", sub: "" };
}

function prizeShort(s) {
  const top = mainPrize(s);
  const total = s.prizes.reduce((a, p) => a + (p.qty || 0), 0);
  const rest = total - (top.qty || 1);
  const name = top.name.length > 48 ? top.name.slice(0, 45).replace(/\s+\S*$/, "") + "…" : top.name;
  let t = (top.qty > 1 ? `${top.qty} × ` : "") + name;
  if (rest > 0) t += ` и ещё ${rest} ${plural(rest, "приз", "приза", "призов")}`;
  return t;
}
function oddsText(r) { return `1 к ${Math.round(r).toLocaleString("ru-RU")}`; }

function starButton(it, cls) {
  const b = el("button", { type: "button", class: cls });
  b.append(icon("star"));
  b.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); toggleFav(it); });
  syncStar(b, it);
  b.dataset.star = it.permit;
  return b;
}
function syncStar(b, it) {
  const on = state.fav.has(it.permit);
  b.setAttribute("aria-pressed", String(on));
  const label = on ? "Убрать из моих лотерей" : "Добавить в мои лотереи";
  b.setAttribute("aria-label", label);
  b.title = label;
  const t = b.querySelector(".lbl");
  if (t) t.textContent = on ? "В моих" : "В мои";
}

function card(it) {
  const s = it.summary, p = phase(it), b = it._brand, st = stub(it);
  const li = el("li", { class: `ticket${p === "closed" ? " is-closed" : ""}${st.urgent ? " urgent" : ""}`, id: `p-${it.permit}` });
  const href = `?l=${encodeURIComponent(it.permit)}`;
  li.style.setProperty("--tint", b.tint);
  li.style.setProperty("--tint-ink", b.ink);
  const cats = it._types.filter(t => t !== "Другое").join(" · ");
  const prize = s?.prizes?.length
    ? el("span", { class: "t-line prize" }, icon("gift"), el("span", {}, prizeShort(s)))
    : el("span", { class: "t-line prize none" }, icon("gift"),
      el("span", {}, s ? "Призы смотрите в правилах" : "Призы появятся, когда разберём правила"));
  const tags = [];
  if (it._fund != null) tags.push(el("span", {}, `Фонд ${money(it._fund, true)}`));
  if (it._odds != null) tags.push(el("span", {}, `Шанс ${oddsText(it._odds)}`));
  if (it.status === "needs_review") tags.push(el("span", { class: "warn" }, "Проверьте по правилам"));
  li.append(
    el("a", { class: "t-hero", href, "data-open": it.permit, tabindex: "-1", "aria-hidden": "true" }, heroOf(it)),
    el("div", { class: "t-row" },
      el("a", { class: "t-main", href, "data-open": it.permit },
        el("span", { class: "t-head" },
          el("span", { class: "mono", "aria-hidden": "true" }, art(it._kind)),
          el("span", {},
            el("span", { class: "t-title" }, titleOf(it), isNew(it) && p !== "soon" ? el("span", { class: "badge" }, "новая") : null),
            el("span", { class: "t-cat" }, cats))),
        el("span", { class: "t-lines" },
          el("span", { class: "t-line" }, icon("cart"), el("b", {}, shortBuy(it))),
          el("span", { class: "t-line" }, icon("store"), el("span", {}, s?.where || it.place)),
          prize),
        el("span", { class: "t-tags" }, tags)),
      el("div", { class: "t-stub" },
        starButton(it, "star"),
        el("span", { class: `s-num${st.small ? " small" : ""}` }, st.num),
        el("span", { class: "s-text" },
          el("span", { class: "s-word" }, st.word, st.l2 ? " " : "", st.l2 ? el("span", { class: "l2" }, st.l2) : null),
          p === "past" && it.results?.winners_url
            ? el("span", { class: "s-sub" }, el("a", { href: it.results.winners_url, target: "_blank", rel: "noopener" }, "Победители ↗"))
            : st.sub ? el("span", { class: "s-sub" }, st.sub) : null)),
      el("span", { class: "notch t", "aria-hidden": "true" }),
      el("span", { class: "notch b", "aria-hidden": "true" })));
  return li;
}

// ---------------------------------------------------------------- мои лотереи

function favItems() { return state.items.filter(it => state.fav.has(it.permit)); }
function toggleFav(it) {
  state.fav.has(it.permit) ? state.fav.delete(it.permit) : state.fav.add(it.permit);
  saveFav();
  $$(`[data-star="${CSS.escape(it.permit)}"]`).forEach(b => syncStar(b, it));
  syncMineCount();
  if (state.page === "mine") renderMine();
}
function syncMineCount() {
  const n = favItems().length;
  $$("[data-mine-count]").forEach(e => { e.textContent = n || ""; });
  $$("[data-mine-count-short]").forEach(e => { e.textContent = n ? ` · ${n}` : ""; });
}

// ---------------------------------------------------------------- календарь

// События на весь день: конец регистрации и будущие розыгрыши.
function calEvents(it) {
  const title = titleOf(it);
  const out = [];
  const re = regEnd(it);
  if (re && re >= state.today && phase(it) !== "past")
    out.push({ id: `reg-${re}`, date: re,
      summary: `${it.category === "service" ? "Конец участия" : "Конец регистрации чеков"}: ${title}` });
  const seen = new Set();  // несколько розыгрышей в один день — одно событие
  for (const d of it.summary?.draws || []) {
    if (!d.date || d.date < state.today || seen.has(d.date)) continue;
    seen.add(d.date);
    out.push({ id: `draw-${d.date}`, date: d.date,
      summary: `Розыгрыш${d.time ? " в " + d.time : ""}: ${title}` });
  }
  return out;
}
function icsText(t) { return String(t).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
// Строки iCalendar не длиннее 75 байт; продолжение начинается с пробела.
function icsFold(line) {
  const enc = new TextEncoder(), parts = [];
  let cur = "", size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) { parts.push(cur); cur = ""; size = 0; }
    cur += ch; size += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}
function icsDate(iso) { return iso.replace(/-/g, ""); }
function nextDay(iso) { return new Date(Date.parse(iso) + dayMs).toISOString().slice(0, 10); }
function buildIcs(it) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const page = linkTo(it);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Laimex//Loterijas//RU", "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH"];
  for (const ev of calEvents(it)) {
    lines.push("BEGIN:VEVENT", `UID:${it.permit}-${ev.id}@laimex`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(ev.date)}`, `DTEND;VALUE=DATE:${icsDate(nextDay(ev.date))}`,
      `SUMMARY:${icsText(ev.summary)}`,
      `DESCRIPTION:${icsText(`Разрешение VID № ${it.permit}. Подробнее: ${page}`)}`,
      `URL:${page}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(icsFold).join("\r\n") + "\r\n";
}
function downloadIcs(it) {
  const blob = new Blob([buildIcs(it)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: `laimex-${it.permit.replace(/[^\w.-]+/g, "_")}.ics` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- подробности

function linkTo(it) { return `${location.origin}${location.pathname}?l=${encodeURIComponent(it.permit)}`; }

async function share(it) {
  const url = linkTo(it), title = titleOf(it);
  if (navigator.share) {
    try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); toast("Ссылка скопирована"); }
  catch (e) { toast(url); }
}

let toastTimer = null;
function toast(text) {
  const t = $("#toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function checkNote(it) {
  const s = it.summary;
  if (!s) return el("p", { class: "check" }, el("strong", {}, "Правила ещё не разобраны. "),
    "Здесь данные из реестра VID; призы и розыгрыши появятся после ближайшего обновления.");
  if (it.status === "partial") return el("div", { class: "check" }, el("strong", {}, "Данные неполные. "),
    s.notes || "Полные правила прочитать не удалось.", " Уточняйте призы и розыгрыши в правилах или на сайте лотереи.");
  if (it.status === "needs_review") {
    const bad = it.checks.filter(c => !c.ok);
    return el("div", { class: "check" }, el("strong", {}, "Проверьте по правилам. "),
      "Автоматическая сверка нашла расхождения:", el("ul", {}, bad.map(c => el("li", {}, c.text))));
  }
  return null;
}

function drawsBlock(it) {
  const s = it.summary, draws = (s?.draws || []).filter(d => d.date).sort((a, b) => a.date.localeCompare(b.date));
  if (!draws.length) return null;
  const nd = nextDraw(it), top = mainPrize(s), win = it.results?.winners_url;
  let mainIdx = -1;
  if (top && draws.length > 1) draws.forEach((d, i) => { if ((d.prizes || []).some(p => p.name === top.name)) mainIdx = i; });
  const items = draws.map((d, i) => {
    const done = d.date < state.today, next = d.date === nd, main = i === mainIdx && !done;
    const cls = done ? "done" : next ? "next" : main ? "main" : "";
    const lbl = done ? (win ? el("a", { href: win, target: "_blank", rel: "noopener" }, "Победители ↗") : "прошёл")
      : next ? "Следующий" : main ? "Главный приз" : (d.time || "");
    const prizes = (d.prizes || []).map(p => `${p.qty} × ${p.name}`).join("; ");
    const period = d.period_from && d.period_to ? `Покупки ${fmtRange(d.period_from, d.period_to)}` : "";
    return el("li", { class: cls, title: [period, prizes].filter(Boolean).join(". ") || null },
      el("span", { class: "dot", "aria-hidden": "true" }), el("b", {}, fmtDate(d.date)), el("span", { class: "lbl" }, lbl));
  });
  const list = el("ol", { class: "draws" }, items);
  const out = [el("p", { class: "k d-sec" }, `Розыгрыши · ${draws.length}`), list];
  // длинный список: два прошедших и десять следующих, остальное по кнопке
  if (draws.length > 12) {
    const ni = nd ? draws.findIndex(d => d.date === nd) : draws.length;
    const from = Math.max(0, Math.min(ni - 2, draws.length - 12)), to = from + 12;
    items.forEach((li, i) => { if (i < from || i >= to) li.hidden = true; });
    const more = el("button", { type: "button", class: "more-draws" }, `Показать все ${draws.length}`);
    more.addEventListener("click", () => { items.forEach(li => { li.hidden = false; }); more.remove(); });
    out.push(more);
  }
  return out;
}

function renderDetail() {
  const layer = $("#detail-layer"), box = $("#detail");
  const it = state.sel && state.items.find(x => x.permit === state.sel);
  if (!it) {
    if (!layer.hidden) { layer.hidden = true; box.replaceChildren(); }
    document.title = state.page === "home" ? BASE_TITLE : `${PAGE_TITLE[state.page]} · Laimex`;
    syncOverlay();
    return;
  }
  const s = it.summary, p = phase(it), st = stub(it), b = it._brand, service = it.category === "service";
  box.style.setProperty("--tint", b.tint);
  box.style.setProperty("--tint-ink", b.ink);
  box.classList.toggle("urgent", !!st.urgent);
  document.title = `${titleOf(it)} · Laimex`;

  const reg = it.links?.registration || s?.registration_url || it.links?.page;
  let regBtn = null;
  if (reg && p === "open") regBtn = el("a", { class: "btn primary", href: reg, target: "_blank", rel: "noopener" },
    service ? "Участвовать" : "Зарегистрировать чек");
  else if (reg && p === "soon") regBtn = el("a", { class: "btn primary", href: reg, target: "_blank", rel: "noopener" }, "Сайт лотереи");
  else if (p === "past" && it.results?.winners_url) regBtn = el("a", { class: "btn primary", href: it.results.winners_url,
    target: "_blank", rel: "noopener" }, "Список победителей");

  const star = starButton(it, "d-act wide");
  star.append(el("span", { class: "lbl" }));
  syncStar(star, it);
  const actions = [
    it.links?.rules ? el("a", { class: "d-act wide", href: it.links.rules, target: "_blank", rel: "noopener" }, icon("doc"), "Правила") : null,
    star,
    calEvents(it).length ? el("button", { type: "button", class: "d-act", onclick: () => downloadIcs(it) }, icon("cal"), "В календарь") : null,
    el("button", { type: "button", class: "d-act", onclick: () => share(it) }, icon("share"), "Поделиться"),
  ].filter(Boolean);

  const sponsor = s?.sponsor || s?.organizer || it.organizer;
  const how = s?.how_to_enter;
  const boxes = [
    el("div", { class: "box" }, el("p", { class: "k" }, service ? "Условие" : "Купить"), el("p", { class: "strong" }, s?.what_to_buy || it.purchase)),
    el("div", { class: "box" }, el("p", { class: "k" }, "Где"), el("p", {}, s?.where || it.place)),
    how ? el("div", { class: "box" }, el("p", { class: "k" }, "Как участвовать"), el("p", {}, how)) : null,
    it._odds != null || it._fund != null ? el("div", { class: "box" }, el("p", { class: "k" }, "Шанс и фонд"),
      el("p", {}, it._odds != null ? el("b", {}, oddsText(it._odds)) : null, it._odds != null && it._fund != null ? " · " : "",
        it._fund != null ? money(it._fund) : null)) : null,
  ].filter(Boolean);
  if (boxes.length % 2) boxes[boxes.length - 1].classList.add("wide");

  const prizes = s?.prizes?.length ? [
    el("p", { class: "k d-sec" }, "Призы"),
    el("ul", { class: "prize-list" }, s.prizes.map(pr => el("li", {},
      el("span", { class: "qty" }, `${pr.qty}×`), el("span", { class: "pn" }, pr.name),
      el("span", { class: "pv" }, money(pr.total_value_eur ?? (pr.unit_value_eur != null ? pr.unit_value_eur * pr.qty : null))))),
      s.prize_fund_eur != null ? el("li", { class: "total" }, el("span", { class: "qty" }), el("span", { class: "pn" }, "Призовой фонд"),
        el("span", { class: "pv" }, money(s.prize_fund_eur))) : null),
  ] : null;

  const res = it.results;
  const facts = [
    ["Лотерея", fmtRange(s?.lottery_start || it.start, s?.lottery_end || it.end)],
    s && ["Регистрация", fmtRange(s.registration_start, s.registration_end)],
    s?.keep && ["Сохраните", s.keep],
    s?.limits && ["Ограничения", s.limits],
    s?.notes && it.status !== "partial" && ["Важно", s.notes],
    s?.winners_published && ["Победители", s.winners_published],
    res?.winners_url && ["Список победителей", el("a", { href: res.winners_url, target: "_blank", rel: "noopener" }, "открыть ↗")],
    res?.winners_url && res.note && ["Итоги", res.note],
    s?.claim_deadline && ["Забрать приз до", fmtDate(s.claim_deadline, true)],
    s?.age_min && ["Возраст", `от ${s.age_min} лет`],
    it.links?.page && ["Страница лотереи", el("a", { href: it.links.page, target: "_blank", rel: "noopener" },
      new URL(it.links.page).hostname.replace(/^www\./, ""))],
    ["Организатор", `${it.organizer}, рег. № ${it.organizer_reg}`],
    ["Условие в реестре", it.purchase],
  ].filter(Boolean);

  const close = el("button", { type: "button", class: "d-close", "aria-label": "Закрыть", onclick: closeDetail }, icon("close"));
  box.replaceChildren(
    close,
    el("div", { class: "d-head" },
      el("span", { class: "mono", "aria-hidden": "true" }, art(it._kind)),
      el("div", { style: "min-width:0" },
        el("h2", { id: "d-title" }, titleOf(it)),
        el("p", { class: "d-meta" }, `Разрешение VID № ${it.permit}${sponsor ? " · " + sponsor : ""}`))),
    el("div", { class: "d-stub" },
      el("div", { class: "d-days" },
        el("span", { class: `d-num${st.small ? " small" : ""}` }, st.num),
        el("span", { class: "d-txt" },
          el("span", { class: "d-word" }, st.long || [st.word, st.l2].filter(Boolean).join(" ")),
          st.sub ? el("span", { class: "d-sub" }, p === "open" && !service ? `чек ${st.sub}` : st.sub) : null)),
      regBtn,
      el("div", { class: "d-actions" }, actions)),
    el("div", { class: "d-cut", "aria-hidden": "true" }),
    el("div", { class: "d-body" },
      checkNote(it),
      el("div", { class: "boxes" }, boxes),
      prizes,
      drawsBlock(it),
      el("p", { class: "k d-sec" }, "Подробно"),
      el("dl", { class: "facts" }, facts.map(([k, v]) => [el("dt", {}, k), el("dd", {}, v)]))));
  const wasHidden = layer.hidden;
  layer.hidden = false;
  box.scrollTop = 0;
  layer.scrollTop = 0;
  syncOverlay();
  if (wasHidden) close.focus({ preventScroll: true });
}

function closeDetail() {
  if (!state.sel) return;
  const permit = state.sel;
  if (history.state?.detail) history.back();
  else navigate(state.page, null, { replace: true });
  const back = $(`.t-main[data-open="${CSS.escape(permit)}"]`);
  if (back) back.focus({ preventScroll: true });
}

// жест «смахнуть вниз» закрывает шторку на телефоне
(function swipe() {
  const box = $("#detail");
  let y0 = null, dy = 0;
  box.addEventListener("touchstart", e => {
    if (!isPhone() || box.scrollTop > 0 || !e.target.closest(".d-head, .d-stub")) return;
    y0 = e.touches[0].clientY; dy = 0; box.classList.add("dragging");
  }, { passive: true });
  box.addEventListener("touchmove", e => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    box.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  box.addEventListener("touchend", () => {
    if (y0 == null) return;
    y0 = null; box.classList.remove("dragging"); box.style.transform = "";
    if (dy > 110) closeDetail();
  });
})();

// ---------------------------------------------------------------- отрисовка

// Заголовок главной меняется при каждом открытии; тот же, что в прошлый раз, не повторяем.
const HEADLINES = [
  ["Чек — твой ", "билет."],
  ["Каждый чек — это ", "шанс."],
  ["Покупай как обычно и ", "выигрывай."],
  ["Удача прячется в ", "чеках."],
  ["Купил, отправил чек, ", "выиграл."],
];
function renderHeadline() {
  const last = readStore("headline", -1);
  let i = Math.floor(Math.random() * (HEADLINES.length - 1));
  if (i >= last && last >= 0) i++;
  writeStore("headline", i);
  const [before, accent, after] = HEADLINES[i];
  $("#headline").replaceChildren(before, el("span", { class: "accent" }, accent), after || "");
}

function renderNextDraw() {
  const box = $("#next-draw");
  let best = null, names = [];
  for (const it of state.items) {
    if (it.category === "service" || tabOf(it) !== "now") continue;
    const nd = nextDraw(it);
    if (!nd) continue;
    if (!best || nd < best) { best = nd; names = [it]; } else if (nd === best) names.push(it);
  }
  if (!best) { box.hidden = true; return; }
  const n = daysBetween(state.today, best);
  const shown = names.slice(0, 2).map(shortName).join(", ") + (names.length > 2 ? ` и ещё ${names.length - 2}` : "");
  const dateLong = n === 0 ? `сегодня, ${fmtDate(best)}` : n === 1 ? `завтра, ${fmtDate(best)}` : `${weekday(best, "long")}, ${fmtDate(best)}`;
  box.replaceChildren(
    el("div", { class: "nd-main" },
      el("p", { class: "nd-kicker" }, "Ближайший розыгрыш"),
      el("p", { class: "nd-date" }, el("span", { class: "long" }, dateLong),
        el("span", { class: "short" }, `${weekday(best, "short")} ${fmtDate(best)} · ${shown}`)),
      el("p", { class: "nd-names" }, shown)),
    el("div", { class: "nd-stub" }, n === 0
      ? el("span", {}, el("span", { class: "nd-n", style: "font-size:18px" }, "сегодня"))
      : el("span", {}, el("span", { class: "nd-n" }, String(n)), el("span", { class: "nd-w" }, dayWord(n)))),
    el("span", { class: "notch t", "aria-hidden": "true" }),
    el("span", { class: "notch b", "aria-hidden": "true" }));
  box.hidden = false;
}

function chip(label, on, onClick) {
  return el("button", { type: "button", class: "chip", "aria-pressed": String(on), onclick: onClick }, label);
}
function renderControls() {
  $$(".tab").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tab === state.tab)));
  const sortName = SORTS.find(([id]) => id === state.sort)[1];
  $("#sort-label").textContent = sortName;
  $("#sort-line").textContent = sortName.toLowerCase();
  $("#sort-menu").replaceChildren(...SORTS.map(([id, label]) => el("button", { type: "button", "aria-pressed": String(state.sort === id),
    onclick: () => { state.sort = id; savePrefs(); setLayer(null); renderHome(); } }, label)));
  $("#f-sort").replaceChildren(...SORTS.map(([id, label]) => chip(label, state.sort === id,
    () => { state.sort = id; savePrefs(); renderHome(); })));
  // в фильтрах — только сети и типы, которые встречаются на вкладке, плюс уже выбранные
  const inTab = state.items.filter(it => tabOf(it) === state.tab);
  const stores = new Set([...inTab.flatMap(it => it._stores), ...state.stores]);
  const types = new Set([...inTab.flatMap(it => it._types), ...state.types]);
  const toggle = (set, v) => () => { set.has(v) ? set.delete(v) : set.add(v); savePrefs(); renderHome(); };
  $("#f-stores").replaceChildren(...STORES.filter(([n]) => stores.has(n)).map(([n]) => chip(n, state.stores.has(n), toggle(state.stores, n))));
  $("#f-types").replaceChildren(...TYPES.filter(t => types.has(t)).map(t => chip(t, state.types.has(t), toggle(state.types, t))));
  $("#f-stores-box").hidden = !$("#f-stores").childElementCount;
  $("#f-types-box").hidden = !$("#f-types").childElementCount;
  const nf = state.stores.size + state.types.size;
  $("#filter-n").textContent = nf;
  $("#filter-n").hidden = !nf;
}

function renderHome() {
  renderControls();
  for (const t of TABS) $(`[data-count="${t}"]`).textContent = state.items.length ? filtered(t).length : "";
  const note = $("#tab-note");
  note.hidden = state.tab === "now";
  note.textContent = state.tab === "past" ? "Завершённые лотереи: итоги и ссылки на списки победителей."
    : "Разрешение VID уже есть, но приём чеков ещё не начался.";
  const list = visible();
  $("#f-apply").textContent = `Показать ${list.length}`;
  const nodes = [];
  let divided = false;
  for (const it of list) {
    if (state.tab === "now" && phase(it) === "closed" && !divided) {
      nodes.push(el("li", { class: "divider" },
        el("h2", {}, "Чеки уже не принимают"),
        el("p", {}, "Регистрация закончилась, но розыгрыши ещё впереди.")));
      divided = true;
    }
    nodes.push(card(it));
  }
  if (!state.types.size && !state.q.trim()) {
    const hidden = state.items.filter(it => it.category === "service" && tabOf(it) === state.tab).length;
    if (hidden) nodes.push(el("li", { class: "hidden-note" },
      `Ещё ${lotteries(hidden)} за услуги (связь, банк, страхование, спортклуб) скрыто. `,
      el("button", { type: "button", onclick: () => { state.types.add("Услуги"); savePrefs(); renderHome(); } }, "Показать")));
  }
  $("#list").replaceChildren(...nodes);
  const st = $("#status");
  if (!state.items.length) return;
  st.textContent = list.length ? ""
    : state.q.trim() || state.stores.size || state.types.size ? "Ничего не нашлось. Уберите фильтры или измените запрос."
    : state.tab === "soon" ? "Новых объявленных лотерей пока нет." : "Здесь пока пусто.";
}

function renderMine() {
  const favs = favItems();
  const groups = [["now", "Идут"], ["soon", "Скоро"], ["past", "Завершились"]];
  const nodes = [];
  for (const [tab, title] of groups) {
    const list = favs.filter(it => tabOf(it) === tab).sort(sorter("mine"));
    if (!list.length) continue;
    nodes.push(el("li", { class: "group-title" }, `${title} · ${list.length}`), ...list.map(card));
  }
  $("#mine-list").replaceChildren(...nodes);
  $("#mine-status").textContent = !state.items.length ? "Загружаем лотереи…"
    : favs.length ? "" : "Пока пусто. Нажмите звёздочку на билете лотереи, и она появится здесь.";
}

function renderStale() {
  const d = state.data;
  const box = $("#stale");
  const fetched = d?.registry_fetched ? new Date(d.registry_fetched) : null;
  const old = fetched && (Date.now() - fetched.getTime()) / dayMs > 3;
  box.hidden = !old;
  if (old) box.textContent = `Список давно не сверялся с реестром VID (последний раз ${fetched.toLocaleDateString("ru-RU",
    { timeZone: "Europe/Riga", day: "numeric", month: "long" })}). Новые лотереи могли ещё не появиться.`;
}

function renderRoute(pageChanged) {
  $$(".page").forEach(sec => { sec.hidden = sec.dataset.page !== state.page; });
  $$("[data-go]").forEach(a => {
    if (a.dataset.go === state.page && !a.classList.contains("brand")) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (state.page === "home") {
    const it = state.sel && state.items.find(x => x.permit === state.sel);
    if (it && tabOf(it) !== state.tab) state.tab = tabOf(it);
    renderHome();
  }
  if (state.page === "mine") renderMine();
  renderDetail();
  if (pageChanged) window.scrollTo(0, 0);
}

// ---------------------------------------------------------------- адреса

// Адреса без «#»: главная — «./», страницы — «?page=…», лотерея — «?l=номер».
function readUrl() {
  const p = new URLSearchParams(location.search);
  const page = p.get("page");
  state.page = PAGES.includes(page) ? page : "home";
  state.sel = p.get("l") || null;
}
function urlFor(page, sel) {
  const p = new URLSearchParams();
  if (page && page !== "home") p.set("page", page);
  if (sel) p.set("l", sel);
  const qs = p.toString();
  return location.pathname + (qs ? `?${qs}` : "");
}
function navigate(page, sel, { replace = false } = {}) {
  const prevPage = state.page;
  const detail = !!sel && !replace && !state.sel;  // открыли поверх списка: «назад» просто закроет
  history[replace ? "replaceState" : "pushState"]({ detail }, "", urlFor(page, sel));
  readUrl();
  setLayer(null);
  renderRoute(prevPage !== state.page);
}
window.addEventListener("popstate", () => {
  const prevPage = state.page;
  readUrl();
  setLayer(null);
  renderRoute(prevPage !== state.page);
});

// ---------------------------------------------------------------- слои: меню, сортировка, фильтры

const phoneQuery = matchMedia("(max-width: 760px)");
function isPhone() { return phoneQuery.matches; }
function setLayer(name) {
  state.layer = name;
  const more = $("#more-menu");
  more.hidden = name !== "more";
  if (!more.hidden && !isPhone()) {
    const r = $("#more-btn").getBoundingClientRect();
    more.style.top = `${r.bottom + 10}px`;
    more.style.left = `${Math.max(16, r.right - 320)}px`;
  } else more.removeAttribute("style");
  $("#sort-menu").hidden = name !== "sort";
  $("#filters").hidden = name !== "filters";
  $("#more-btn").setAttribute("aria-expanded", String(name === "more"));
  $("#tabbar-more").setAttribute("aria-expanded", String(name === "more"));
  $("#sort-btn").setAttribute("aria-expanded", String(name === "sort"));
  $("#filter-btn").setAttribute("aria-expanded", String(name === "filters"));
  syncOverlay();
}
// Затемнение и запрет прокрутки: под подробностями и под шторками телефона.
function syncOverlay() {
  const sheet = isPhone() && (state.layer === "more" || state.layer === "filters");
  const detail = !$("#detail-layer").hidden;
  $("#scrim").hidden = !(sheet || detail);
  document.documentElement.classList.toggle("locked", sheet || detail);
}
phoneQuery.addEventListener("change", () => setLayer(null));
window.addEventListener("resize", () => { if (state.layer === "more" && !isPhone()) setLayer("more"); });

$("#more-btn").addEventListener("click", () => setLayer(state.layer === "more" ? null : "more"));
$("#tabbar-more").addEventListener("click", () => setLayer(state.layer === "more" ? null : "more"));
$("#sort-btn").addEventListener("click", () => setLayer(state.layer === "sort" ? null : "sort"));
$("#filter-btn").addEventListener("click", () => setLayer(state.layer === "filters" ? null : "filters"));
$("#f-apply").addEventListener("click", () => setLayer(null));
$("#f-reset").addEventListener("click", () => { state.stores.clear(); state.types.clear(); savePrefs(); renderHome(); });
$("#scrim").addEventListener("click", () => { if (state.layer) setLayer(null); else closeDetail(); });
$("#detail-layer").addEventListener("click", e => { if (e.target === e.currentTarget) closeDetail(); });
// щелчок мимо выпадающего меню закрывает его
document.addEventListener("click", e => {
  if (!state.layer || isPhone()) return;
  const keep = { more: "#more-menu, #more-btn", sort: ".sort-anchor", filters: "#filters, #filter-btn" }[state.layer];
  // путь берём из события: кнопку фильтра к этому моменту уже могли перерисовать
  if (!e.composedPath().some(n => n instanceof Element && n.matches(keep))) setLayer(null);
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (state.layer) setLayer(null);
  else if (state.sel) closeDetail();
});

$$(".tab").forEach(b => b.addEventListener("click", () => {
  state.tab = b.dataset.tab; savePrefs(); renderHome();
}));
$("#q").addEventListener("input", e => { state.q = e.target.value; renderHome(); });

// внутренние ссылки — без перезагрузки; внешние — в новом окне
document.addEventListener("click", e => {
  const a = e.target.closest("a[href]");
  if (!a) return;
  if (a.origin !== location.origin) { a.target = "_blank"; a.rel = "noopener"; return; }
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (a.dataset.open) { e.preventDefault(); navigate(state.page, a.dataset.open); }
  else if (a.dataset.go) { e.preventDefault(); navigate(a.dataset.go, null); }
});

// ---------------------------------------------------------------- тема

function applyTheme() {
  const root = document.documentElement;
  if (state.theme === "auto") delete root.dataset.theme; else root.dataset.theme = state.theme;
  $$("[data-theme-pick]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.themePick === state.theme)));
  const cyc = $("#theme-cycle");
  cyc.setAttribute("aria-label", `Тема оформления: ${THEME_LABEL[state.theme]}`);
  cyc.title = `Тема: ${THEME_LABEL[state.theme]}`;
  cyc.replaceChildren(icon(state.theme));
  $("#theme-color").content = getComputedStyle(root).getPropertyValue("--page").trim();
}
function setTheme(t) { state.theme = t; writeStore("theme", t); applyTheme(); }
$$("[data-theme-pick]").forEach(b => b.addEventListener("click", () => setTheme(b.dataset.themePick)));
$("#theme-cycle").addEventListener("click", () => setTheme(THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length]));
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
applyTheme();

// ---------------------------------------------------------------- установка

// Компьютер: пункт «Установить приложение» в меню «Ещё». Android: через минуту или после
// нескольких действий внизу один раз за сессию появляется предложение, кнопка открывает
// системный диалог установки. Если приложение уже стоит, браузер событие не присылает.
let deferred = null, actions = 0, waited = false;
const android = /android/i.test(navigator.userAgent);
function standalone() { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; }
function syncInstall() {
  $$("[data-install]").forEach(b => { if (!b.closest("#install-offer")) b.hidden = !deferred; });
  if (!deferred) $("#install-offer").hidden = true;
}
function maybeOffer() {
  if (!android || !deferred || standalone() || !(waited || actions >= 4)) return;
  if (readStore("installOffer", false, sessionStorage)) return;
  writeStore("installOffer", true, sessionStorage);
  $("#install-offer").hidden = false;
}
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; syncInstall(); maybeOffer(); });
window.addEventListener("appinstalled", () => { deferred = null; syncInstall(); });
$$("[data-install]").forEach(b => b.addEventListener("click", async () => {
  if (!deferred) return;
  const d = deferred;
  deferred = null;
  setLayer(null);
  $("#install-offer").hidden = true;
  d.prompt();
  try { await d.userChoice; } catch (e) { /* пользователь закрыл диалог */ }
  syncInstall();
}));
$("#install-offer-close").addEventListener("click", () => { $("#install-offer").hidden = true; });
setTimeout(() => { waited = true; maybeOffer(); }, 75000);
document.addEventListener("click", e => { if (e.target.closest("a, button")) { actions++; maybeOffer(); } });

// ---------------------------------------------------------------- загрузка

async function load() {
  try {
    const r = await fetch("data.json", { cache: "no-cache" });
    const data = await r.json();
    state.data = data;
    state.items = data.lotteries.map(raw => {
      const it = { ...raw, permit: String(raw.permit) };
      it._stores = storesOf(it);
      it._any = anyStore(it);
      it._types = typesOf(it);
      it._brand = brandOf(it);
      it._kind = kindOf(it);
      it._odds = oddsOf(it);
      it._fund = it.summary?.prize_fund_eur ?? null;
      it._spend = spendOf(it);
      it._hay = haystack(it);
      return it;
    });
  } catch (e) {
    $("#status").textContent = "Не удалось загрузить список. Проверьте интернет и обновите страницу.";
    return;
  }
  $("#status").textContent = "";
  renderNextDraw();
  renderStale();
  syncMineCount();
  renderRoute(false);
}

// старые ссылки вида «#p-9114» ведут на новую карточку
function legacyHash() {
  if (!location.hash.startsWith("#p-")) return false;
  history.replaceState(null, "", urlFor("home", decodeURIComponent(location.hash.slice(3))));
  return true;
}
window.addEventListener("hashchange", () => { if (legacyHash()) { readUrl(); renderRoute(true); } });
legacyHash();
readUrl();
renderHeadline();
renderControls();
renderRoute(false);
syncMineCount();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

load();
