"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = { tab: "now", q: "", filters: new Set(), items: [], today: rigaToday() };

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
function haystack(it) {
  const s = it.summary || {};
  return [it.name, it.organizer, it.purchase, it.place, s.title, s.sponsor, s.what_to_buy, s.buy_short,
    s.where, ...(s.prizes || []).map(p => p.name)].join(" ").toLowerCase();
}

// Короткая строка «что купить»: из выжимки, иначе обрезаем полную.
function shortBuy(it) {
  const s = it.summary;
  if (s?.buy_short) return s.buy_short;
  const full = s?.what_to_buy || it.purchase || "";
  const cut = full.split(/;|\(| — /)[0].trim();
  return cut.length > 110 ? cut.slice(0, 105).replace(/\s+\S*$/, "") + "…" : cut;
}

function visible() {
  const q = state.q.trim().toLowerCase();
  let list = state.items.filter(it => tabOf(it) === state.tab);
  // лотереи за услуги скрыты, но поиск находит и их
  if (!state.filters.has("service") && !q) list = list.filter(it => it.category !== "service");
  if (state.filters.has("ending")) list = list.filter(it =>
    phase(it) === "open" && daysBetween(state.today, regEnd(it)) <= 7);
  if (state.filters.has("draw")) list = list.filter(it => {
    const d = nextDraw(it); return d && daysBetween(state.today, d) <= 3;
  });
  if (q) list = list.filter(it => it._hay.includes(q));
  const rank = { open: 0, closed: 1, soon: 0, past: 0 };
  const by = {
    now: (a, b) => rank[phase(a)] - rank[phase(b)] ||
      (phase(a) === "open" ? regEnd(a).localeCompare(regEnd(b)) : a.end.localeCompare(b.end)),
    soon: (a, b) => a.start.localeCompare(b.start),
    past: (a, b) => b.end.localeCompare(a.end),
  }[state.tab];
  return list.sort(by);
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

function render() {
  const counts = { now: 0, soon: 0, past: 0 };
  for (const it of state.items) {
    if (!state.filters.has("service") && it.category === "service") continue;
    if (phase(it) === "closed") continue; // в счётчике — только где можно участвовать
    counts[tabOf(it)]++;
  }
  for (const [k, v] of Object.entries(counts)) $(`[data-count="${k}"]`).textContent = v;
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
  if (!state.filters.has("service") && !state.q.trim()) {
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
    st.textContent = state.q || state.filters.size
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
  if (tabOf(it) !== state.tab) { state.tab = tabOf(it); syncTabs(); render(); }
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

async function load() {
  try {
    const r = await fetch("data.json", { cache: "no-cache" });
    const data = await r.json();
    state.items = data.lotteries.map(it => ({ ...it, _hay: haystack(it) }));
    const upd = new Date(data.updated);
    $("#updated").textContent = `Обновлено ${upd.toLocaleString("ru-RU", { timeZone: "Europe/Riga", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}.`;
    render();
    openFromHash();
  } catch (e) {
    $("#status").textContent = "Не удалось загрузить список. Проверьте интернет и обновите страницу.";
  }
}

$$(".tab").forEach(b => b.addEventListener("click", () => { state.tab = b.dataset.tab; syncTabs(); render(); }));
$$(".chip").forEach(b => b.addEventListener("click", () => {
  const f = b.dataset.filter;
  state.filters.has(f) ? state.filters.delete(f) : state.filters.add(f);
  b.setAttribute("aria-pressed", String(state.filters.has(f)));
  render();
}));
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
