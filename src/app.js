const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);

const TROY_OZ_TO_GRAMS = 31.1034768;

const YF_RANGES = [
  { key: "1d", label: "1D", range: "1d", interval: "5m" },
  { key: "5d", label: "1W", range: "5d", interval: "15m" },
  { key: "1mo", label: "1M", range: "1mo", interval: "1d" },
  { key: "6mo", label: "6M", range: "6mo", interval: "1d" },
  { key: "1y", label: "1Y", range: "1y", interval: "1wk" },
  { key: "5y", label: "5Y", range: "5y", interval: "1mo" }
];

const MF_RANGES = [
  { key: "1mo", label: "1M", days: 31 },
  { key: "6mo", label: "6M", days: 186 },
  { key: "1y", label: "1Y", days: 366 },
  { key: "5y", label: "5Y", days: 1830 },
  { key: "all", label: "All", days: null }
];

const METALS = [
  { id: "gold", symbol: "GC=F", label: "Gold", sub: "COMEX spot", gramsPerUnit: 10, inrUnitLabel: "10g" },
  { id: "silver", symbol: "SI=F", label: "Silver", sub: "COMEX spot", gramsPerUnit: 1000, inrUnitLabel: "kg" }
];

const state = {
  watchlist: [],
  quotes: {},       // id -> { price, change, changePercent, currency, error, ...statsFields } — also holds "gold"/"silver"
  usdInr: null,
  mfCache: {},       // schemeCode -> full MfData
  settings: { refreshIntervalSecs: 15, hiddenMetals: [], displayCurrency: "inr" },
  refreshTimer: null,
  activeItemId: null,
  activeRangeKey: null,
  chart: null,
  editMode: false,
  searchDebounce: null
};

// ---------- formatting ----------

function formatMoney(value, currency) {
  if (value == null || Number.isNaN(value)) return "\u2014";
  const symbol = currency === "USD" ? "$" : currency === "INR" ? "\u20b9" : (currency ? currency + " " : "");
  const decimals = value >= 1 ? 2 : 4;
  return symbol + value.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatChange(change, changePercent) {
  if (change == null || changePercent == null) return { text: "\u2014", cls: "flat" };
  const cls = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const sign = change > 0 ? "+" : "";
  return { text: `${sign}${change.toFixed(2)} (${sign}${changePercent.toFixed(2)}%)`, cls };
}

function timeNow() {
  return new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// Single source of truth for currency display: given an item + its quote,
// returns a multiplier plus the currency/unit to show. Used for list rows,
// the detail header, and the chart's y-axis, so all three always agree.
function conversionFor(item, quote) {
  if (state.settings.displayCurrency !== "inr" || state.usdInr == null) {
    return { factor: 1, currency: (quote && quote.currency) || "USD" };
  }
  if (item.kind === "metal") {
    const metal = METALS.find((m) => m.id === item.id);
    const factor = (state.usdInr / TROY_OZ_TO_GRAMS) * metal.gramsPerUnit;
    return { factor, currency: "INR" };
  }
  if (quote && quote.currency === "USD") {
    return { factor: state.usdInr, currency: "INR" };
  }
  return { factor: 1, currency: (quote && quote.currency) || "" };
}

// ---------- init ----------

async function init() {
  try {
    state.settings = await invoke("settings_get");
  } catch (e) {
    console.error("settings_get failed", e);
  }
  if (!state.settings.hiddenMetals) state.settings.hiddenMetals = [];

  try {
    state.watchlist = await invoke("watchlist_get");
  } catch (e) {
    console.error("watchlist_get failed", e);
  }

  try {
    const enabled = await invoke("autostart_get");
    document.getElementById("startupToggle").checked = !!enabled;
  } catch (e) {
    console.error("autostart_get failed", e);
  }

  syncIntervalDropdownUI();
  syncCurrencySegmentedUI();
  renderList();
  wireStaticEvents();

  await Promise.all([fetchGoldSilver(), refreshWatchlistQuotes(true)]);
  setLastUpdated();
  startRefreshLoop();
}

function startRefreshLoop() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  const ms = Math.max(5, state.settings.refreshIntervalSecs) * 1000;
  state.refreshTimer = setInterval(async () => {
    await Promise.all([fetchGoldSilver(), refreshWatchlistQuotes(false)]);
    setLastUpdated();
  }, ms);
}

function setLastUpdated() {
  document.getElementById("lastUpdated").textContent = `Updated ${timeNow()}`;
}

// ---------- gold / silver ----------

async function fetchGoldSilver() {
  const [gold, silver, fx] = await Promise.allSettled([
    invoke("get_quote", { symbol: "GC=F" }),
    invoke("get_quote", { symbol: "SI=F" }),
    invoke("get_quote", { symbol: "INR=X" })
  ]);

  state.usdInr = fx.status === "fulfilled" ? fx.value.price : null;
  state.quotes.gold = gold.status === "fulfilled" ? gold.value : { error: true };
  state.quotes.silver = silver.status === "fulfilled" ? silver.value : { error: true };

  renderList();
  if (state.activeItemId === "gold" || state.activeItemId === "silver") refreshActiveChartHeader();
}

function metalInrText(metal) {
  const q = state.quotes[metal.id];
  if (!q || q.error || q.price == null || state.usdInr == null) return null;
  const perGram = q.price / TROY_OZ_TO_GRAMS;
  const value = perGram * state.usdInr * metal.gramsPerUnit;
  return `\u2248 ${formatMoney(value, "INR")} / ${metal.inrUnitLabel}`;
}

// ---------- list rendering ----------

function renderList() {
  const body = document.getElementById("watchlistBody");
  body.innerHTML = "";

  let anyMetalVisible = false;
  for (const metal of METALS) {
    const row = buildMetalRow(metal);
    if (row) { body.appendChild(row); anyMetalVisible = true; }
  }

  if (state.watchlist.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = anyMetalVisible
      ? `<p class="empty-sub">Nothing else yet — search above to add a stock, ETF, or mutual fund.</p>`
      : `<p class="empty-sub">List's empty. Search above to add something, or hit Edit to bring Gold/Silver back.</p>`;
    body.appendChild(empty);
    return;
  }

  for (const item of state.watchlist) {
    body.appendChild(buildWatchRow(item));
  }
}

function buildMetalRow(metal) {
  const hidden = state.settings.hiddenMetals.includes(metal.id);
  if (hidden && !state.editMode) return null;

  const row = document.createElement("div");
  row.className = "watch-row" + (state.activeItemId === metal.id ? " active" : "") + (hidden ? " row-hidden" : "");

  const q = state.quotes[metal.id];
  const item = { id: metal.id, kind: "metal" };
  let priceText = "\u2014", changeText = "\u2014", changeCls = "flat", sub = metal.sub;

  if (q && q.error) {
    priceText = "err";
  } else if (q && q.price != null) {
    const conv = conversionFor(item, q);
    priceText = formatMoney(q.price * conv.factor, conv.currency);
    const convertedChange = q.change != null ? q.change * conv.factor : null;
    const ch = formatChange(convertedChange, q.changePercent);
    changeText = ch.text;
    changeCls = ch.cls;

    if (conv.currency === "INR") {
      sub = `${metal.sub}, per ${metal.inrUnitLabel} \u00b7 $${q.price.toFixed(2)}/oz spot`;
    } else {
      const inrText = metalInrText(metal);
      sub = metal.sub + (inrText ? ` \u00b7 ${inrText}` : "");
    }
  }

  row.innerHTML = `
    <div class="wr-name">
      <span class="n"><span class="dot ${metal.id}"></span>${metal.label}</span>
      <span class="s">${escapeHtml(sub)}</span>
    </div>
    <span class="wr-price">${priceText}</span>
    <span class="wr-change-pill ${changeCls}">${changeText}</span>
    <span></span>
  `;

  if (state.editMode) {
    const btn = document.createElement("button");
    btn.className = "wr-remove";
    btn.textContent = hidden ? "+" : "\u00d7";
    btn.title = hidden ? "Show in list" : "Hide from list";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMetalHidden(metal.id);
    });
    row.lastElementChild.replaceWith(btn);
  } else {
    row.addEventListener("click", () => {
      openChartFor({ id: metal.id, kind: "metal", symbol: metal.symbol, label: metal.label, sub: metal.sub });
    });
  }

  return row;
}

function buildWatchRow(item) {
  const row = document.createElement("div");
  row.className = "watch-row" + (item.id === state.activeItemId ? " active" : "");
  row.dataset.id = item.id;

  const q = state.quotes[item.id];
  let priceText = "\u2014", changeText = "\u2014", changeCls = "flat";
  if (q && q.error) {
    priceText = "err";
  } else if (q && q.price != null) {
    const conv = conversionFor(item, q);
    priceText = formatMoney(q.price * conv.factor, conv.currency);
    const convertedChange = q.change != null ? q.change * conv.factor : null;
    const ch = formatChange(convertedChange, q.changePercent);
    changeText = ch.text;
    changeCls = ch.cls;
  }

  row.innerHTML = `
    <div class="wr-name">
      <span class="n">${escapeHtml(item.label)}</span>
      <span class="s">${escapeHtml(item.sub)}</span>
    </div>
    <span class="wr-price">${priceText}</span>
    <span class="wr-change-pill ${changeCls}">${changeText}</span>
    <span></span>
  `;

  if (state.editMode) {
    const btn = document.createElement("button");
    btn.className = "wr-remove";
    btn.textContent = "\u00d7";
    btn.title = "Remove";
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      state.watchlist = state.watchlist.filter((w) => w.id !== item.id);
      delete state.quotes[item.id];
      await invoke("watchlist_save", { items: state.watchlist });
      if (state.activeItemId === item.id) closeChart();
      renderList();
    });
    row.lastElementChild.replaceWith(btn);
  } else {
    row.addEventListener("click", () => openChartFor(item));
  }

  return row;
}

async function toggleMetalHidden(id) {
  const list = state.settings.hiddenMetals;
  const idx = list.indexOf(id);
  if (idx === -1) list.push(id); else list.splice(idx, 1);
  try {
    await invoke("settings_save", { settings: state.settings });
  } catch (err) {
    console.error("settings_save failed", err);
  }
  renderList();
}

async function refreshWatchlistQuotes(includeMf) {
  const tasks = state.watchlist.map(async (item) => {
    try {
      if (item.kind === "yahoo") {
        const q = await invoke("get_quote", { symbol: item.symbol });
        state.quotes[item.id] = q;
      } else if (item.kind === "mf_in" && includeMf) {
        const data = await invoke("mf_data", { schemeCode: item.symbol });
        state.mfCache[item.symbol] = data;
        state.quotes[item.id] = {
          price: data.latestNav,
          change: data.change,
          changePercent: data.changePercent,
          currency: "INR"
        };
      }
    } catch (err) {
      state.quotes[item.id] = { error: true };
      console.error("quote refresh failed", item.symbol, err);
    }
  });
  await Promise.all(tasks);
  renderList();
  if (state.activeItemId) refreshActiveChartHeader();
}

// ---------- detail overlay ----------

function findActiveItem() {
  const metal = METALS.find((m) => m.id === state.activeItemId);
  if (metal) return { id: metal.id, kind: "metal", symbol: metal.symbol, label: metal.label, sub: metal.sub };
  return state.watchlist.find((w) => w.id === state.activeItemId);
}

function openChartFor(item) {
  state.activeItemId = item.id;
  document.getElementById("detailModalBackdrop").hidden = false;
  document.getElementById("chartTitle").textContent = item.label;
  document.getElementById("chartSub").textContent = item.sub;

  const ranges = item.kind === "mf_in" ? MF_RANGES : YF_RANGES;
  state.activeRangeKey = item.kind === "mf_in" ? "1y" : "1mo";

  const tabs = document.getElementById("rangeTabs");
  tabs.innerHTML = "";
  for (const r of ranges) {
    const btn = document.createElement("button");
    btn.className = "range-tab" + (r.key === state.activeRangeKey ? " active" : "");
    btn.textContent = r.label;
    btn.dataset.key = r.key;
    btn.addEventListener("click", () => {
      state.activeRangeKey = r.key;
      tabs.querySelectorAll(".range-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      loadChartData(item);
    });
    tabs.appendChild(btn);
  }

  refreshActiveChartHeader();
  loadChartData(item);
  renderList();
}

function refreshActiveChartHeader() {
  const item = findActiveItem();
  if (!item) return;
  const q = state.quotes[item.id];
  const priceEl = document.getElementById("chartPrice");
  const changeEl = document.getElementById("chartChange");

  if (!q || q.error) {
    priceEl.textContent = "\u2014";
    changeEl.textContent = "";
  } else {
    const conv = conversionFor(item, q);
    priceEl.textContent = formatMoney(q.price * conv.factor, conv.currency);
    const convertedChange = q.change != null ? q.change * conv.factor : null;
    const ch = formatChange(convertedChange, q.changePercent);
    changeEl.textContent = ch.text;
    changeEl.className = "chart-change " + ch.cls;

    if (item.kind === "metal") {
      const metal = METALS.find((m) => m.id === item.id);
      if (conv.currency === "INR") {
        document.getElementById("chartSub").textContent = `${item.sub}, per ${metal.inrUnitLabel} \u00b7 $${q.price.toFixed(2)}/oz spot`;
      } else {
        const inrText = metalInrText(metal);
        document.getElementById("chartSub").textContent = item.sub + (inrText ? ` \u00b7 ${inrText}` : "");
      }
    }
  }

  buildStatsGrid(item);
}

function buildStatsGrid(item) {
  const grid = document.getElementById("statsGrid");
  grid.innerHTML = "";

  const addStat = (label, value) => {
    if (value == null || value === "") return;
    const div = document.createElement("div");
    div.className = "stat-item";
    div.innerHTML = `<span class="stat-label">${escapeHtml(label)}</span><span class="stat-value">${value}</span>`;
    grid.appendChild(div);
  };

  if (item.kind === "mf_in") {
    const data = state.mfCache[item.symbol];
    if (data) {
      addStat("Latest NAV Date", data.latestDate);
      addStat("Category", "Mutual Fund (India)");
    }
    return;
  }

  const q = state.quotes[item.id];
  if (!q || q.error) return;

  addStat("Exchange", q.exchangeName ? escapeHtml(q.exchangeName) : null);
  addStat("Open", q.open != null ? formatMoney(q.open, q.currency) : null);
  if (q.dayLow != null && q.dayHigh != null) {
    addStat("Day Range", `${formatMoney(q.dayLow, q.currency)} \u2013 ${formatMoney(q.dayHigh, q.currency)}`);
  }
  if (q.fiftyTwoWeekLow != null && q.fiftyTwoWeekHigh != null) {
    addStat("52W Range", `${formatMoney(q.fiftyTwoWeekLow, q.currency)} \u2013 ${formatMoney(q.fiftyTwoWeekHigh, q.currency)}`);
  }
  addStat("Prev Close", q.prevClose != null ? formatMoney(q.prevClose, q.currency) : null);
  if (q.volume != null) addStat("Volume", Math.round(q.volume).toLocaleString("en-IN"));
}

let chartRequestId = 0;

async function loadChartData(item) {
  const requestId = ++chartRequestId;
  const wrap = document.querySelector(".chart-canvas-wrap");
  const existingError = wrap.querySelector(".chart-error");
  if (existingError) existingError.remove();

  try {
    let points;
    if (item.kind === "mf_in") {
      let data = state.mfCache[item.symbol];
      if (!data) {
        data = await invoke("mf_data", { schemeCode: item.symbol });
        state.mfCache[item.symbol] = data;
      }
      const rangeDef = MF_RANGES.find((r) => r.key === state.activeRangeKey);
      points = data.points;
      if (rangeDef && rangeDef.days) {
        const cutoff = Date.now() - rangeDef.days * 86400000;
        points = points.filter((p) => p.t >= cutoff);
      }
    } else {
      const rangeDef = YF_RANGES.find((r) => r.key === state.activeRangeKey);
      const hist = await invoke("get_history", { symbol: item.symbol, range: rangeDef.range, interval: rangeDef.interval });
      points = hist.points;
      const conv = conversionFor(item, state.quotes[item.id] || hist.quote);
      if (conv.factor !== 1) {
        points = points.map((p) => ({ t: p.t, c: p.c * conv.factor }));
      }
    }
    if (requestId !== chartRequestId) return;
    renderChart(points);
  } catch (err) {
    if (requestId !== chartRequestId) return;
    console.error("chart load failed", err);
    const existing = Chart.getChart(document.getElementById("priceChart"));
    if (existing) existing.destroy();
    state.chart = null;
    const div = document.createElement("div");
    div.className = "chart-error";
    div.textContent = "Could not load chart data: " + String(err).slice(0, 140);
    wrap.appendChild(div);
  }
}

function renderChart(points) {
  const canvas = document.getElementById("priceChart");
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  const labels = points.map((p) => new Date(p.t));
  const data = points.map((p) => p.c);

  state.chart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        data,
        borderColor: "#c9a24b",
        backgroundColor: "rgba(201,162,75,0.08)",
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.15,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          type: "time",
          ticks: { color: "#5b5d64", maxRotation: 0, font: { size: 10 } },
          grid: { color: "#20232b" }
        },
        y: {
          ticks: { color: "#5b5d64", font: { size: 10 } },
          grid: { color: "#20232b" }
        }
      }
    }
  });
}

function closeChart() {
  state.activeItemId = null;
  const existing = Chart.getChart(document.getElementById("priceChart"));
  if (existing) existing.destroy();
  state.chart = null;
  document.getElementById("detailModalBackdrop").hidden = true;
  renderList();
}

// ---------- search-to-add ----------

function wireSearch() {
  const input = document.getElementById("searchInput");
  const resultsEl = document.getElementById("searchResults");

  input.addEventListener("input", () => {
    clearTimeout(state.searchDebounce);
    const query = input.value.trim();
    if (query.length < 2) { resultsEl.hidden = true; resultsEl.innerHTML = ""; return; }
    state.searchDebounce = setTimeout(() => runSearch(query), 350);
  });

  input.addEventListener("focus", () => {
    if (resultsEl.innerHTML.trim() !== "") resultsEl.hidden = false;
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) resultsEl.hidden = true;
  });
}

async function runSearch(query) {
  const resultsEl = document.getElementById("searchResults");
  resultsEl.hidden = false;
  resultsEl.innerHTML = `<div class="search-status">Searching&hellip;</div>`;

  const [marketRes, mfRes] = await Promise.allSettled([
    invoke("market_search", { query }),
    invoke("mf_search", { query })
  ]);

  const items = [];
  if (marketRes.status === "fulfilled") {
    for (const r of marketRes.value.slice(0, 8)) {
      items.push({ kind: "yahoo", symbol: r.symbol, label: r.name, sub: [r.exchange, r.quoteType].filter(Boolean).join(" \u00b7 ") });
    }
  }
  if (mfRes.status === "fulfilled") {
    for (const r of mfRes.value.slice(0, 8)) {
      items.push({ kind: "mf_in", symbol: String(r.schemeCode), label: r.schemeName, sub: "Mutual Fund (India)" });
    }
  }

  if (items.length === 0) {
    resultsEl.innerHTML = `<div class="search-status">No matches.</div>`;
    return;
  }

  resultsEl.innerHTML = "";
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "search-result-row";
    row.innerHTML = `
      <button class="search-add-btn" title="Add">+</button>
      <div class="sr-text">
        <span class="sr-name">${escapeHtml(item.label)}</span>
        <span class="sr-sub">${escapeHtml(item.sub)}</span>
      </div>
    `;
    const btn = row.querySelector(".search-add-btn");
    btn.addEventListener("click", () => addFromSearch(item, btn));
    resultsEl.appendChild(row);
  }
}

async function addFromSearch(item, btn) {
  btn.disabled = true;
  try {
    if (state.watchlist.some((w) => w.kind === item.kind && w.symbol === item.symbol)) {
      // already tracked, nothing to do
    } else if (item.kind === "yahoo") {
      const q = await invoke("get_quote", { symbol: item.symbol });
      const watchItem = { id: crypto.randomUUID(), kind: "yahoo", symbol: item.symbol, label: item.label, sub: item.sub || q.exchangeName || "" };
      state.watchlist.push(watchItem);
      state.quotes[watchItem.id] = q;
    } else {
      const data = await invoke("mf_data", { schemeCode: item.symbol });
      state.mfCache[item.symbol] = data;
      const watchItem = { id: crypto.randomUUID(), kind: "mf_in", symbol: item.symbol, label: item.label, sub: "Mutual Fund (India)" };
      state.watchlist.push(watchItem);
      state.quotes[watchItem.id] = { price: data.latestNav, change: data.change, changePercent: data.changePercent, currency: "INR" };
    }
    await invoke("watchlist_save", { items: state.watchlist });
    renderList();
    document.getElementById("searchInput").value = "";
    document.getElementById("searchResults").hidden = true;
  } catch (err) {
    console.error("add from search failed", err);
    btn.disabled = false;
  }
}

// ---------- settings ----------

function openSettingsModal() {
  document.getElementById("settingsModalBackdrop").hidden = false;
  document.getElementById("settingsError").textContent = "";
}
function closeSettingsModal() {
  document.getElementById("settingsModalBackdrop").hidden = true;
}

function syncIntervalDropdownUI() {
  const label = document.getElementById("intervalTriggerLabel");
  const menu = document.getElementById("intervalMenu");
  const match = menu.querySelector(`.dropdown-item[data-value="${state.settings.refreshIntervalSecs}"]`);
  menu.querySelectorAll(".dropdown-item").forEach((i) => i.classList.remove("selected"));
  if (match) {
    label.textContent = match.textContent;
    match.classList.add("selected");
  } else {
    label.textContent = `${state.settings.refreshIntervalSecs} seconds`;
  }
}

function wireIntervalDropdown() {
  const trigger = document.getElementById("intervalTrigger");
  const menu = document.getElementById("intervalMenu");

  trigger.addEventListener("click", () => { menu.hidden = !menu.hidden; });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#intervalDropdown")) menu.hidden = true;
  });

  menu.querySelectorAll(".dropdown-item").forEach((item) => {
    item.addEventListener("click", async () => {
      state.settings.refreshIntervalSecs = parseInt(item.dataset.value, 10);
      syncIntervalDropdownUI();
      menu.hidden = true;
      try {
        await invoke("settings_save", { settings: state.settings });
        startRefreshLoop();
      } catch (err) {
        document.getElementById("settingsError").textContent = "Could not save: " + String(err).slice(0, 120);
      }
    });
  });
}

function syncCurrencySegmentedUI() {
  document.querySelectorAll("#currencySegmented .segmented-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.value === state.settings.displayCurrency);
  });
}

function wireCurrencySegmented() {
  document.querySelectorAll("#currencySegmented .segmented-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.dataset.value === state.settings.displayCurrency) return;
      state.settings.displayCurrency = btn.dataset.value;
      syncCurrencySegmentedUI();
      renderList();
      if (state.activeItemId) {
        refreshActiveChartHeader();
        loadChartData(findActiveItem());
      }
      try {
        await invoke("settings_save", { settings: state.settings });
      } catch (err) {
        document.getElementById("settingsError").textContent = "Could not save: " + String(err).slice(0, 120);
      }
    });
  });
}

// ---------- wiring ----------

function wireStaticEvents() {
  document.getElementById("refreshBtn").addEventListener("click", async (e) => {
    e.currentTarget.classList.add("spinning");
    await Promise.all([fetchGoldSilver(), refreshWatchlistQuotes(true)]);
    setLastUpdated();
    setTimeout(() => e.currentTarget.classList.remove("spinning"), 600);
  });

  document.getElementById("editToggleBtn").addEventListener("click", (e) => {
    state.editMode = !state.editMode;
    e.currentTarget.classList.toggle("active", state.editMode);
    e.currentTarget.textContent = state.editMode ? "Done" : "Edit";
    renderList();
  });

  wireSearch();

  document.getElementById("closeChartBtn").addEventListener("click", closeChart);
  document.getElementById("detailModalBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "detailModalBackdrop") closeChart();
  });

  document.getElementById("settingsBtn").addEventListener("click", openSettingsModal);
  document.getElementById("closeSettingsBtn").addEventListener("click", closeSettingsModal);
  document.getElementById("settingsModalBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "settingsModalBackdrop") closeSettingsModal();
  });

  wireIntervalDropdown();
  wireCurrencySegmented();

  document.getElementById("startupToggle").addEventListener("change", async (e) => {
    const enabled = e.target.checked;
    try {
      const actual = await invoke("autostart_set", { enabled });
      e.target.checked = actual;
    } catch (err) {
      e.target.checked = !enabled;
      document.getElementById("settingsError").textContent = "Could not update: " + String(err).slice(0, 120);
    }
  });
}

window.addEventListener("DOMContentLoaded", init);
