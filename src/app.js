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
  quotes: {},      // id -> { price, change, changePercent, currency, error } — also holds "gold"/"silver"
  usdInr: null,
  mfCache: {},      // schemeCode -> full MfData
  settings: { refreshIntervalSecs: 15 },
  refreshTimer: null,
  activeItemId: null,
  activeRangeKey: null,
  chart: null,
  addMode: "yahoo",
  mfSearchDebounce: null
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

// ---------- init ----------

async function init() {
  try {
    state.settings = await invoke("settings_get");
  } catch (e) {
    console.error("settings_get failed", e);
  }
  document.getElementById("intervalSelect").value = String(state.settings.refreshIntervalSecs);

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

// ---------- watchlist ----------

function renderList() {
  const body = document.getElementById("watchlistBody");
  body.innerHTML = "";

  for (const metal of METALS) {
    body.appendChild(buildMetalRow(metal));
  }

  body.appendChild(buildAddRow());

  if (state.watchlist.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `<p class="empty-sub">Nothing else yet — add a stock, ETF, or mutual fund above.</p>`;
    body.appendChild(empty);
    return;
  }

  for (const item of state.watchlist) {
    body.appendChild(buildWatchRow(item));
  }
}

function buildMetalRow(metal) {
  const row = document.createElement("div");
  row.className = "watch-row" + (state.activeItemId === metal.id ? " active" : "");

  const q = state.quotes[metal.id];
  let priceText = "\u2014", changeText = "\u2014", changeCls = "flat";
  if (q && q.error) {
    priceText = "err";
  } else if (q) {
    priceText = formatMoney(q.price, "USD");
    const ch = formatChange(q.change, q.changePercent);
    changeText = ch.text;
    changeCls = ch.cls;
  }
  const inrText = metalInrText(metal);
  const sub = metal.sub + (inrText ? ` \u00b7 ${inrText}` : "");

  row.innerHTML = `
    <div class="wr-name">
      <span class="n"><span class="dot ${metal.id}"></span>${metal.label}</span>
      <span class="s">${escapeHtml(sub)}</span>
    </div>
    <span class="wr-price">${priceText}</span>
    <span class="wr-change ${changeCls}">${changeText}</span>
    <span></span>
  `;

  row.addEventListener("click", () => {
    openChartFor({ id: metal.id, kind: "metal", symbol: metal.symbol, label: metal.label, sub: metal.sub });
  });

  return row;
}

function buildAddRow() {
  const row = document.createElement("div");
  row.className = "add-row";
  row.innerHTML = `<span class="add-row-icon">+</span> Add stock, ETF, or mutual fund`;
  row.addEventListener("click", openAddModal);
  return row;
}

function buildWatchRow(item) {
  const row = document.createElement("div");
  row.className = "watch-row" + (item.id === state.activeItemId ? " active" : "");
  row.dataset.id = item.id;

  const q = state.quotes[item.id];
  let priceText = "\u2014", changeHtml = "\u2014", changeCls = "flat";
  if (q && q.error) {
    priceText = "err";
  } else if (q) {
    priceText = formatMoney(q.price, q.currency);
    const ch = formatChange(q.change, q.changePercent);
    changeHtml = ch.text;
    changeCls = ch.cls;
  }

  row.innerHTML = `
    <div class="wr-name">
      <span class="n">${escapeHtml(item.label)}</span>
      <span class="s">${escapeHtml(item.sub)}</span>
    </div>
    <span class="wr-price">${priceText}</span>
    <span class="wr-change ${changeCls}">${changeHtml}</span>
    <button class="wr-remove" title="Remove">&times;</button>
  `;

  row.addEventListener("click", (e) => {
    if (e.target.closest(".wr-remove")) return;
    openChartFor(item);
  });
  row.querySelector(".wr-remove").addEventListener("click", async (e) => {
    e.stopPropagation();
    state.watchlist = state.watchlist.filter((w) => w.id !== item.id);
    delete state.quotes[item.id];
    await invoke("watchlist_save", { items: state.watchlist });
    if (state.activeItemId === item.id) closeChart();
    renderList();
  });

  return row;
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

// ---------- chart ----------

function openChartFor(item) {
  state.activeItemId = item.id;
  document.getElementById("chartPlaceholder").hidden = true;
  document.getElementById("chartActive").hidden = false;
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

function findActiveItem() {
  const metal = METALS.find((m) => m.id === state.activeItemId);
  if (metal) return { id: metal.id, kind: "metal", symbol: metal.symbol, label: metal.label, sub: metal.sub };
  return state.watchlist.find((w) => w.id === state.activeItemId);
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
    return;
  }
  priceEl.textContent = formatMoney(q.price, q.currency || "USD");
  const ch = formatChange(q.change, q.changePercent);
  changeEl.textContent = ch.text;
  changeEl.className = "chart-change " + ch.cls;

  if (item.kind === "metal") {
    const metal = METALS.find((m) => m.id === item.id);
    const inrText = metalInrText(metal);
    document.getElementById("chartSub").textContent = item.sub + (inrText ? ` \u00b7 ${inrText}` : "");
  }
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
    }
    if (requestId !== chartRequestId) return; // a newer request superseded this one — drop stale result
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
  // Ask Chart.js's own registry, not just our local variable — if state.chart
  // ever gets out of sync with what's actually attached to the canvas (e.g.
  // an out-of-order async response), this is what actually prevents the
  // "canvas already in use" crash instead of just usually avoiding it.
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
  if (state.chart) { state.chart.destroy(); state.chart = null; }
  document.getElementById("chartActive").hidden = true;
  document.getElementById("chartPlaceholder").hidden = false;
  renderList();
}

// ---------- add modal ----------

function openAddModal() {
  document.getElementById("addModalBackdrop").hidden = false;
  document.getElementById("tickerInput").value = "";
  document.getElementById("tickerError").textContent = "";
  document.getElementById("mfSearchInput").value = "";
  document.getElementById("mfResults").innerHTML = "";
  document.getElementById("mfError").textContent = "";
}

function closeAddModal() {
  document.getElementById("addModalBackdrop").hidden = true;
}

function setAddMode(mode) {
  state.addMode = mode;
  document.querySelectorAll(".modal-tab").forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
  document.getElementById("modeYahoo").hidden = mode !== "yahoo";
  document.getElementById("modeMfIn").hidden = mode !== "mf_in";
}

async function addTicker() {
  const input = document.getElementById("tickerInput");
  const errEl = document.getElementById("tickerError");
  const symbol = input.value.trim().toUpperCase();
  errEl.textContent = "";
  if (!symbol) { errEl.textContent = "Enter a ticker symbol."; return; }

  const btn = document.getElementById("addTickerBtn");
  btn.disabled = true;
  try {
    const q = await invoke("get_quote", { symbol });
    if (q.price == null) throw new Error("No price data for this symbol");

    const item = {
      id: crypto.randomUUID(),
      kind: "yahoo",
      symbol,
      label: symbol,
      sub: [q.exchangeName, q.instrumentType].filter(Boolean).join(" \u00b7 ") || (q.currency || "")
    };
    state.watchlist.push(item);
    state.quotes[item.id] = q;
    await invoke("watchlist_save", { items: state.watchlist });
    renderList();
    closeAddModal();
  } catch (err) {
    errEl.textContent = "Could not add: " + String(err).slice(0, 120);
  } finally {
    btn.disabled = false;
  }
}

function wireMfSearch() {
  const input = document.getElementById("mfSearchInput");
  input.addEventListener("input", () => {
    clearTimeout(state.mfSearchDebounce);
    const query = input.value.trim();
    const resultsEl = document.getElementById("mfResults");
    const errEl = document.getElementById("mfError");
    errEl.textContent = "";
    if (query.length < 3) { resultsEl.innerHTML = ""; return; }

    state.mfSearchDebounce = setTimeout(async () => {
      try {
        const results = await invoke("mf_search", { query });
        resultsEl.innerHTML = "";
        for (const r of results.slice(0, 25)) {
          const div = document.createElement("div");
          div.className = "mf-result-item";
          div.innerHTML = `${escapeHtml(r.schemeName)}<br><span class="code">${escapeHtml(String(r.schemeCode))}</span>`;
          div.addEventListener("click", () => addMfItem(r.schemeCode, r.schemeName));
          resultsEl.appendChild(div);
        }
        if (results.length === 0) errEl.textContent = "No funds matched.";
      } catch (err) {
        errEl.textContent = "Search failed: " + String(err).slice(0, 120);
      }
    }, 400);
  });
}

async function addMfItem(schemeCode, schemeName) {
  const errEl = document.getElementById("mfError");
  try {
    const data = await invoke("mf_data", { schemeCode: String(schemeCode) });
    state.mfCache[String(schemeCode)] = data;

    const item = {
      id: crypto.randomUUID(),
      kind: "mf_in",
      symbol: String(schemeCode),
      label: schemeName,
      sub: "Mutual Fund (India)"
    };
    state.watchlist.push(item);
    state.quotes[item.id] = {
      price: data.latestNav,
      change: data.change,
      changePercent: data.changePercent,
      currency: "INR"
    };
    await invoke("watchlist_save", { items: state.watchlist });
    renderList();
    closeAddModal();
  } catch (err) {
    errEl.textContent = "Could not add: " + String(err).slice(0, 120);
  }
}

// ---------- settings modal ----------

function openSettingsModal() {
  document.getElementById("settingsModalBackdrop").hidden = false;
  document.getElementById("settingsError").textContent = "";
}
function closeSettingsModal() {
  document.getElementById("settingsModalBackdrop").hidden = true;
}

// ---------- wiring ----------

function wireStaticEvents() {
  document.getElementById("refreshBtn").addEventListener("click", async (e) => {
    e.currentTarget.classList.add("spinning");
    await Promise.all([fetchGoldSilver(), refreshWatchlistQuotes(true)]);
    setLastUpdated();
    setTimeout(() => e.currentTarget.classList.remove("spinning"), 600);
  });

  document.getElementById("closeAddBtn").addEventListener("click", closeAddModal);
  document.getElementById("addModalBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "addModalBackdrop") closeAddModal();
  });
  document.querySelectorAll(".modal-tab").forEach((tab) => {
    tab.addEventListener("click", () => setAddMode(tab.dataset.mode));
  });
  document.getElementById("addTickerBtn").addEventListener("click", addTicker);
  document.getElementById("tickerInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") addTicker();
  });
  wireMfSearch();

  document.getElementById("closeChartBtn").addEventListener("click", closeChart);

  document.getElementById("settingsBtn").addEventListener("click", openSettingsModal);
  document.getElementById("closeSettingsBtn").addEventListener("click", closeSettingsModal);
  document.getElementById("settingsModalBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "settingsModalBackdrop") closeSettingsModal();
  });

  document.getElementById("intervalSelect").addEventListener("change", async (e) => {
    const secs = parseInt(e.target.value, 10);
    state.settings.refreshIntervalSecs = secs;
    try {
      await invoke("settings_save", { settings: state.settings });
      startRefreshLoop();
    } catch (err) {
      document.getElementById("settingsError").textContent = "Could not save: " + String(err).slice(0, 120);
    }
  });

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
