"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = { tab: "now", q: "", filters: new Set(), store: null, sort: "ending", compact: false,
  fav: new Set(), items: [], today: rigaToday() };

// ---------------------------------------------------------------- хранилище

// Всё, что помним между заходами; без хранилища (приватный режим) сайт просто не помнит.
function readStore(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
  catch (e) { return fallback; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* без хранилища */ }
}
function savePrefs() {
  writeStore("prefs", { tab: state.tab, filters: [...state.filters], store: state.store,
    sort: state.sort, compact: state.compact });
}
function saveFav() { writeStore("fav", [...state.fav]); }
(function restore() {
  const p = readStore("prefs", {}) || {};
  if (["now", "soon", "past", "fav"].includes(p.tab)) state.tab = p.tab;
  if (Array.isArray(p.filters)) state.filters = new Set(p.filters.filter(f => typeof f === "string"));
  if (typeof p.store === "string") state.store = p.store;
  if (["ending", "prize", "new"].includes(p.sort)) state.sort = p.sort;
  state.compact = p.compact === true;
  const fav = readStore("fav", []);
  if (Array.isArray(fav)) state.fav = new Set(fav.map(String));
})();

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
function money(n) {
  if (n == null) return "";
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "EUR",
    minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(n);
}
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
function days(n) { return `${n} ${plural(n, "день", "дня", "дней")}`; }
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") e.className = v; else e.setAttribute(k, v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== "") e.append(k);
  return e;
}

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
// Поиск без учёта регистра и латышской диакритики: ā→a, š→s, ļ→l.
function norm(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, ""); }
function haystack(it) {
  const s = it.summary || {};
  return norm([it.name, it.organizer, it.purchase, it.place, s.title, s.sponsor, s.what_to_buy, s.buy_short,
    s.where, ...(s.prizes || []).map(p => p.name)].join(" "));
}

// Торговые сети: ищем название в «где покупать» (реестр и выжимка). Оговорки вроде
// «(izņemot veikalu Rimi)» / «(кроме магазина Rimi)» не считаются.
const STORES = [
  ["Maxima", "maxima|barbora"], ["Rimi"], ["Lidl"], ["Top"], ["Elvi"], ["Mego"], ["Vesko"], ["Spar"], ["Aibe"],
  ["LaTS"], ["Citro"], ["Drogas"], ["Apotheka"], ["Benu"], ["Mēness aptieka"], ["Euroaptieka"], ["Stenders"],
  ["Depo"], ["Narvesen"], ["Circle K"], ["Virši"], ["Pepco"],
].map(([name, words]) => [name, new RegExp(`(^|[^\\p{L}])(${words || norm(name)})(?!\\p{L})`, "u")]);
function storesOf(it) {
  const where = norm(`${it.place || ""} ${it.summary?.where || ""}`)
    .replace(/\(?\s*(izn?emot|кроме)[^),.;]*\)?/gu, " ");
  return STORES.filter(([, re]) => re.test(where)).map(([name]) => name);
}

// Сумма для сортировки «Крупный приз»: призовой фонд, иначе самый дорогой приз.
function prizeValue(it) {
  const s = it.summary;
  if (s?.prize_fund_eur != null) return s.prize_fund_eur;
  return mainPrize(s)?.unit_value_eur || 0;
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

function inTab(it) { return state.tab === "fav" ? state.fav.has(it.permit) : tabOf(it) === state.tab; }

// Лотереи вкладки до фильтров (из них же — список сетей для чипов).
function tabItems() {
  const q = norm(state.q.trim());
  let list = state.items.filter(inTab);
  // лотереи за услуги скрыты, но поиск находит и их; отмеченные видны всегда
  if (state.tab !== "fav" && !state.filters.has("service") && !q) list = list.filter(it => it.category !== "service");
  return list;
}

function visible() {
  const q = norm(state.q.trim());
  let list = tabItems();
  if (state.filters.has("ending")) list = list.filter(it =>
    phase(it) === "open" && daysBetween(state.today, regEnd(it)) <= 7);
  if (state.filters.has("draw")) list = list.filter(it => {
    const d = nextDraw(it); return d && daysBetween(state.today, d) <= 3;
  });
  if (state.store) list = list.filter(it => it._stores.includes(state.store));
  if (q) list = list.filter(it => it._hay.includes(q));
  // на «Идут сейчас» закрытые для чеков всегда ниже; в отмеченных — по фазам
  const rank = state.tab === "fav" ? { open: 0, closed: 1, soon: 2, past: 3 } : { open: 0, closed: 1, soon: 0, past: 0 };
  const soonest = (a, b) => phase(a) === "past" ? b.end.localeCompare(a.end)
    : phase(a) === "soon" ? a.start.localeCompare(b.start)
    : phase(a) === "open" ? regEnd(a).localeCompare(regEnd(b)) : a.end.localeCompare(b.end);
  const by = {
    ending: soonest,
    prize: (a, b) => prizeValue(b) - prizeValue(a) || soonest(a, b),
    new: (a, b) => b.start.localeCompare(a.start) || soonest(a, b),
  }[state.sort];
  return list.sort((a, b) => rank[phase(a)] - rank[phase(b)] || by(a, b));
}

// ---------------------------------------------------------------- карточка

function leftLabel(it) {
  const p = phase(it);
  if (p === "soon") return { text: `с ${fmtDate(it.start)}`, hot: false };
  if (p === "past") return { text: `завершилась ${fmtDate(it.end)}`, hot: false };
  if (p === "closed") return { text: "регистрация закрыта", hot: false };
  const n = daysBetween(state.today, regEnd(it));
  if (n === 0) return { text: "последний день", hot: true };
  return { text: `ещё ${days(n)}`, hot: n <= 3 };
}

function prizeLine(s) {
  if (!s?.prizes?.length) return "смотрите в правилах";
  const top = mainPrize(s);
  const total = s.prizes.reduce((a, p) => a + (p.qty || 0), 0);
  const rest = total - (top.qty || 1);
  let name = top.name.length > 48 ? top.name.slice(0, 45).replace(/\s+\S*$/, "") + "…" : top.name;
  let t = (top.qty > 1 ? `${top.qty} × ` : "") + name;
  if (rest > 0) t += ` и ещё ${rest}`;
  if (s.prize_fund_eur != null) t += `, фонд ${money(s.prize_fund_eur)}`;
  return t;
}

function regLine(it) {
  const p = phase(it), s = it.summary;
  if (p === "closed") return `приём закрыт ${fmtDate(regEnd(it))}`;
  if (p === "soon") return s?.registration_start ? `${fmtRange(s.registration_start, regEnd(it))}` : `с ${fmtDate(it.start)}`;
  if (!s) return `${fmtDate(it.end)} (уточните в правилах)`;
  return fmtDate(regEnd(it));
}

function card(it) {
  const node = $("#card-tpl").content.firstElementChild.cloneNode(true);
  const s = it.summary, p = phase(it);
  node.id = `p-${it.permit}`;
  node.classList.toggle("is-closed", p === "closed");
  $(".t-title", node).textContent = s?.title || it.name || it.purchase;
  if (isNew(it)) $(".t-title", node).append(" ", el("span", { class: "badge" }, "новая"));
  const star = $(".t-star", node);
  syncStar(star, it);
  star.addEventListener("click", () => toggleFav(it, star));
  $(".t-org", node).textContent = s?.sponsor || s?.organizer || it.organizer;
  const left = leftLabel(it);
  const lt = $(".t-left", node);
  lt.textContent = left.text;
  lt.classList.toggle("hot", left.hot);
  $(".r-buy", node).textContent = shortBuy(it);
  if (it.category === "service") {  // за услугу: чека нет
    $(".r-row:nth-child(1) dt", node).textContent = "Условие";
    $(".r-row:nth-child(2) dt", node).textContent = "Участие до";
    $(".t-register", node).textContent = "Участвовать";
  }
  $(".r-reg", node).textContent = regLine(it);
  $(".r-prize", node).textContent = prizeLine(s);

  const nd = nextDraw(it);
  if (nd && p !== "past") {
    const n = daysBetween(state.today, nd);
    const when = n === 0 ? "сегодня" : n === 1 ? "завтра" : `через ${days(n)}`;
    $(".t-next", node).append(p === "closed" ? "Розыгрыш: " : "Ближайший розыгрыш: ",
      el("b", {}, fmtDate(nd)), ` (${when})`);
  }

  const reg = it.links?.registration || s?.registration_url || it.links?.page;
  const regA = $(".t-register", node);
  if (reg && p === "open") regA.href = reg;
  else if (reg && p === "soon") { regA.href = reg; regA.textContent = "Сайт лотереи"; regA.classList.remove("primary"); }
  else regA.hidden = true;
  const rulesA = $(".t-rules", node);
  if (it.links?.rules) rulesA.href = it.links.rules; else rulesA.hidden = true;
  const cal = $(".t-cal", node);
  if (calEvents(it).length) cal.addEventListener("click", () => downloadIcs(it));
  else cal.hidden = true;

  const more = $(".t-more", node), det = $(".t-details", node);
  more.addEventListener("click", () => {
    const open = det.hidden;
    if (open && !det.childElementCount) det.append(...details(it));
    det.hidden = !open;
    more.setAttribute("aria-expanded", String(open));
    more.textContent = open ? "Свернуть" : "Подробнее";
    if (open) history.replaceState(null, "", `#${node.id}`);
  });
  return node;
}

// ---------------------------------------------------------------- отмеченные

function syncStar(btn, it) {
  const on = state.fav.has(it.permit);
  btn.setAttribute("aria-pressed", String(on));
  btn.setAttribute("aria-label", on ? "Убрать из отмеченных" : "Отметить лотерею");
  btn.title = on ? "Убрать из отмеченных" : "Отметить";
  btn.textContent = on ? "★" : "☆";
}
function toggleFav(it, btn) {
  state.fav.has(it.permit) ? state.fav.delete(it.permit) : state.fav.add(it.permit);
  saveFav();
  if (state.tab === "fav") { render(); return; }
  syncStar(btn, it);
  $('[data-count="fav"]').textContent = favCount();
}
function favCount() { return state.items.filter(it => state.fav.has(it.permit)).length; }

// ---------------------------------------------------------------- календарь

// События на весь день: конец регистрации и будущие розыгрыши.
function calEvents(it) {
  const title = it.summary?.title || it.name || it.purchase;
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
  const page = `${location.origin}${location.pathname}#p-${it.permit}`;
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

function details(it) {
  const s = it.summary, out = [];
  if (!s) {
    out.push(el("p", { class: "pending" }, "Правила этой лотереи ещё не разобраны. Ниже — данные из реестра VID; подробности появятся после следующего обновления."));
  } else if (it.status === "partial") {
    out.push(el("div", { class: "check warn" }, el("strong", {}, "Данные неполные. "),
      s.notes || "Полные правила прочитать не удалось.", " Уточняйте призы и розыгрыши в правилах или на сайте лотереи."));
  } else if (it.status === "ok") {
    out.push(el("p", { class: "check ok" }, `Сверено автоматически: даты совпадают с реестром VID, сумма призов сходится с фондом (${it.checks.length} ${plural(it.checks.length, "проверка", "проверки", "проверок")}).`));
  } else {
    const bad = it.checks.filter(c => !c.ok);
    out.push(el("div", { class: "check warn" }, el("strong", {}, "Проверьте по правилам. "),
      "Автоматическая сверка нашла расхождения:", el("ul", {}, bad.map(c => el("li", {}, c.text)))));
  }

  out.push(el("h3", {}, it.category === "service" ? "Что нужно сделать" : "Что купить и где"));
  out.push(el("p", {}, s?.what_to_buy || it.purchase));
  out.push(el("p", {}, s?.where || it.place));

  if (s?.how_to_enter || s?.keep || s?.limits) {
    out.push(el("h3", {}, "Как участвовать"));
    if (s.how_to_enter) out.push(el("p", {}, s.how_to_enter));
    if (s.keep) out.push(el("p", {}, `Сохраните: ${s.keep}`));
    if (s.limits) out.push(el("p", {}, s.limits));
    if (s.notes && it.status !== "partial") out.push(el("p", {}, s.notes));
  }

  if (s?.draws?.length) {
    out.push(el("h3", {}, `Розыгрыши (${s.draws.length})`));
    const nd = nextDraw(it);
    out.push(el("ol", { class: "draws" }, s.draws.map(d => {
      const cls = d.date && d.date < state.today ? "done" : d.date === nd ? "next" : null;
      const prizes = (d.prizes || []).map(p => `${p.qty} × ${p.name}`).join("; ");
      const period = d.period_from && d.period_to ? `покупки ${fmtRange(d.period_from, d.period_to)}` : "";
      return el("li", { class: cls }, el("span", {},
        `${fmtDate(d.date)}${d.time ? ", " + d.time : ""}`,
        el("small", {}, [period, prizes].filter(Boolean).join(". "))));
    })));
  }
  const res = it.results;
  if (res?.winners_url || res?.note) {
    out.push(el("h3", {}, "Результаты"));
    if (res.winners_url) out.push(el("p", {}, el("a", { href: res.winners_url, target: "_blank", rel: "noopener" },
      "Список победителей")));
    if (res.note) out.push(el("p", {}, res.note));
  }

  if (s?.prizes?.length) {
    out.push(el("h3", {}, "Призы"));
    const rows = s.prizes.map(p => el("tr", {},
      el("td", {}, p.name),
      el("td", {}, `${p.qty} × ${money(p.unit_value_eur) || "?"}`),
      el("td", {}, money(p.total_value_eur))));
    out.push(el("div", { class: "table-wrap" }, el("table", { class: "prizes" }, el("tbody", {}, rows),
      s.prize_fund_eur != null ? el("tfoot", {}, el("tr", {}, el("td", {}, "Призовой фонд"), el("td", {}), el("td", {}, money(s.prize_fund_eur)))) : null)));
  }

  out.push(el("h3", {}, "Даты и организатор"));
  const facts = [
    ["Лотерея", fmtRange(s?.lottery_start || it.start, s?.lottery_end || it.end)],
    s && ["Регистрация", fmtRange(s.registration_start, s.registration_end)],
    s?.winners_published && ["Победители", s.winners_published],
    s?.claim_deadline && ["Забрать приз до", fmtDate(s.claim_deadline, true)],
    s?.age_min && ["Возраст", `от ${s.age_min} лет`],
    s?.odds && ["Шанс выиграть", s.odds],
    it.links?.page && ["Страница лотереи", el("a", { href: it.links.page, target: "_blank", rel: "noopener" },
      new URL(it.links.page).hostname.replace(/^www\./, ""))],
    ["Организатор", `${it.organizer}, рег. № ${it.organizer_reg}`],
    ["Разрешение VID", `№ ${it.permit}`],
    ["Условие в реестре", it.purchase],
  ].filter(Boolean);
  out.push(el("dl", { class: "facts" }, facts.map(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])));
  return out;
}

// ---------------------------------------------------------------- отрисовка

function renderStores() {
  const present = new Set(tabItems().flatMap(it => it._stores));
  if (state.store) present.add(state.store);  // выбранную сеть всегда можно снять
  const box = $("#stores");
  box.replaceChildren(...STORES.filter(([name]) => present.has(name)).map(([name]) => {
    const b = el("button", { class: "chip", type: "button", "aria-pressed": String(state.store === name) }, name);
    b.addEventListener("click", () => {
      state.store = state.store === name ? null : name;
      savePrefs(); render();
    });
    return b;
  }));
  box.hidden = !box.childElementCount;
}

function render() {
  const counts = { now: 0, soon: 0, past: 0 };
  for (const it of state.items) {
    if (!state.filters.has("service") && it.category === "service") continue;
    if (phase(it) === "closed") continue; // в счётчике — только где можно участвовать
    counts[tabOf(it)]++;
  }
  counts.fav = favCount();
  for (const [k, v] of Object.entries(counts)) $(`[data-count="${k}"]`).textContent = v;
  renderStores();
  const list = visible();
  const nodes = [];
  let divided = false;
  for (const it of list) {
    if (state.tab === "now" && phase(it) === "closed" && !divided) {
      nodes.push(el("li", { class: "divider" },
        el("h2", {}, "Регистрация закончилась"),
        el("p", {}, "Чеки уже не принимают, но розыгрыши ещё впереди.")));
      divided = true;
    }
    nodes.push(card(it));
  }
  if (state.tab !== "fav" && !state.filters.has("service") && !state.q.trim()) {
    const hidden = state.items.filter(it => it.category === "service" && tabOf(it) === state.tab).length;
    if (hidden) {
      const btn = el("button", { class: "link" }, "Показать");
      btn.addEventListener("click", () => $('.chip[data-filter="service"]').click());
      nodes.push(el("li", { class: "hidden-note" },
        `Ещё ${hidden} ${plural(hidden, "лотерея", "лотереи", "лотерей")} за услуги (связь, банк, страхование, спортклуб) скрыто. `, btn));
    }
  }
  $("#list").replaceChildren(...nodes);
  const st = $("#status");
  if (!list.length) {
    st.textContent = state.tab === "fav" && !favCount()
      ? "Отметьте лотереи звёздочкой ☆ — они появятся здесь, даже когда завершатся."
      : state.q || state.filters.size || state.store
      ? "Ничего не нашлось. Уберите фильтры или измените запрос."
      : state.tab === "soon" ? "Новых объявленных лотерей пока нет." : "Здесь пока пусто.";
  } else if (state.tab === "now") {
    const open = list.filter(it => phase(it) === "open").length;
    st.textContent = `Можно участвовать: ${open} ${plural(open, "лотерея", "лотереи", "лотерей")}`;
  } else {
    st.textContent = `${list.length} ${plural(list.length, "лотерея", "лотереи", "лотерей")}`;
  }
}

function openFromHash() {
  const id = location.hash.slice(1);
  if (!id.startsWith("p-")) return;
  const it = state.items.find(x => `p-${x.permit}` === id);
  if (!it) return;
  if (!inTab(it)) { state.tab = tabOf(it); syncTabs(); render(); }
  const li = document.getElementById(id);
  if (!li) return;
  li.classList.add("focus");
  const btn = $(".t-more", li);
  if (btn.getAttribute("aria-expanded") === "false") btn.click();
  li.scrollIntoView({ block: "start" });
}

function syncTabs() {
  $$(".tab").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tab === state.tab)));
}
function syncControls() {
  syncTabs();
  $$(".chip[data-filter]").forEach(b => b.setAttribute("aria-pressed", String(state.filters.has(b.dataset.filter))));
  $("#sort").value = state.sort;
  $("#compact").setAttribute("aria-pressed", String(state.compact));
  document.body.classList.toggle("compact", state.compact);
}

async function load() {
  try {
    const r = await fetch("data.json", { cache: "no-cache" });
    const data = await r.json();
    state.items = data.lotteries.map(it => ({ ...it, permit: String(it.permit), _hay: haystack(it), _stores: storesOf(it) }));
    const upd = new Date(data.updated);
    $("#updated").textContent = `Обновлено ${upd.toLocaleString("ru-RU", { timeZone: "Europe/Riga", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}.`;
    render();
    openFromHash();
  } catch (e) {
    $("#status").textContent = "Не удалось загрузить список. Проверьте интернет и обновите страницу.";
  }
}

$$(".tab").forEach(b => b.addEventListener("click", () => {
  state.tab = b.dataset.tab; syncTabs(); savePrefs(); render();
}));
$$(".chip[data-filter]").forEach(b => b.addEventListener("click", () => {
  const f = b.dataset.filter;
  state.filters.has(f) ? state.filters.delete(f) : state.filters.add(f);
  b.setAttribute("aria-pressed", String(state.filters.has(f)));
  savePrefs(); render();
}));
$("#sort").addEventListener("change", e => { state.sort = e.target.value; savePrefs(); render(); });
$("#compact").addEventListener("click", () => {
  state.compact = !state.compact; syncControls(); savePrefs();
});
syncControls();
$("#q").addEventListener("input", e => { state.q = e.target.value; render(); });
window.addEventListener("hashchange", openFromHash);
// любые ссылки на другие сайты открываются в новом окне
document.addEventListener("click", e => {
  const a = e.target.closest("a[href]");
  if (a && a.origin !== location.origin) { a.target = "_blank"; a.rel = "noopener"; }
}, true);

// ---------------------------------------------------------------- установка

let deferred = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault(); deferred = e; $("#install").hidden = false;
});
$("#install").addEventListener("click", async () => {
  if (!deferred) return;
  deferred.prompt();
  await deferred.userChoice;
  deferred = null; $("#install").hidden = true;
});
(function iosHint() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.navigator.standalone || matchMedia("(display-mode: standalone)").matches;
  let dismissed = false;
  try { dismissed = localStorage.getItem("iosHint") === "1"; } catch (e) { /* без хранилища */ }
  if (ios && !standalone && !dismissed) $("#ios-hint").hidden = false;
  $("#ios-hint-close").addEventListener("click", () => {
    $("#ios-hint").hidden = true;
    try { localStorage.setItem("iosHint", "1"); } catch (e) { /* без хранилища */ }
  });
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

load();
