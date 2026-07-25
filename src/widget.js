const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);

const METAL_INFO = {
  gold: { symbol: "GC=F", inSymbol: "GOLDBEES.NS", label: "Gold" },
  silver: { symbol: "SI=F", inSymbol: "SILVERBEES.NS", label: "Silver" }
};

let refreshTimer = null;

function formatMoney(value, currency) {
  if (value == null || Number.isNaN(value)) return "\u2014";
  const symbol = currency === "USD" ? "$" : currency === "INR" ? "\u20b9" : (currency ? currency + " " : "");
  const decimals = value >= 1 ? 2 : 4;
  return symbol + value.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatChangePercent(changePercent) {
  if (changePercent == null) return { text: "\u2014", cls: "flat" };
  const cls = changePercent > 0 ? "up" : changePercent < 0 ? "down" : "flat";
  const sign = changePercent > 0 ? "+" : "";
  return { text: `${sign}${changePercent.toFixed(2)}%`, cls };
}

// "kind:id" e.g. "metal:gold", "yahoo:AAPL", "mf_in:120503"
function parseAssetRef(ref) {
  const idx = (ref || "").indexOf(":");
  if (idx === -1) return { kind: ref || "", id: "" };
  return { kind: ref.slice(0, idx), id: ref.slice(idx + 1) };
}

// Currency is normalized here so the ratio is never dividing INR by USD by
// accident — same rule the main window uses: only USD converts to INR (and
// only when that mode is on), everything else passes through untouched.
async function fetchAsset(ref, useInr, usdInr) {
  const { kind, id } = parseAssetRef(ref);

  if (kind === "metal") {
    const info = METAL_INFO[id];
    if (!info) return null;
    const symbol = useInr ? info.inSymbol : info.symbol;
    try {
      const q = await invoke("get_quote", { symbol });
      return { label: info.label, price: q.price, changePercent: q.changePercent, currency: useInr ? "INR" : "USD" };
    } catch {
      return { label: info.label, error: true };
    }
  }

  if (kind === "mf_in") {
    try {
      const data = await invoke("mf_data", { schemeCode: id });
      return { label: data.schemeName || id, price: data.latestNav, changePercent: data.changePercent, currency: "INR" };
    } catch {
      return { label: id, error: true };
    }
  }

  try {
    const q = await invoke("get_quote", { symbol: id });
    let price = q.price;
    let currency = q.currency;
    if (useInr && q.currency === "USD" && usdInr != null && price != null) {
      price = price * usdInr;
      currency = "INR";
    }
    return { label: id, price, changePercent: q.changePercent, currency };
  } catch {
    return { label: id, error: true };
  }
}

function renderAsset(suffix, asset) {
  document.getElementById(`name${suffix}`).textContent = asset ? asset.label : "\u2014";
  const priceEl = document.getElementById(`price${suffix}`);
  const changeEl = document.getElementById(`change${suffix}`);

  if (!asset || asset.error || asset.price == null) {
    priceEl.textContent = asset && asset.error ? "err" : "\u2014";
    changeEl.textContent = "";
    changeEl.className = "widget-change";
    return null;
  }

  priceEl.textContent = formatMoney(asset.price, asset.currency);
  const ch = formatChangePercent(asset.changePercent);
  changeEl.textContent = ch.text;
  changeEl.className = "widget-change " + ch.cls;
  return asset.price;
}

async function refresh() {
  let settings;
  try {
    settings = await invoke("settings_get");
  } catch (e) {
    console.error("settings_get failed", e);
    scheduleNext(15);
    return;
  }

  const useInr = settings.displayCurrency === "inr";
  let usdInr = null;
  if (useInr) {
    try {
      const fx = await invoke("get_quote", { symbol: "INR=X" });
      usdInr = fx.price;
    } catch (e) {
      console.error("fx fetch failed", e);
    }
  }

  const [assetA, assetB] = await Promise.all([
    fetchAsset(settings.widgetAssetA, useInr, usdInr),
    fetchAsset(settings.widgetAssetB, useInr, usdInr)
  ]);

  const priceA = renderAsset("A", assetA);
  const priceB = renderAsset("B", assetB);

  const ratioEl = document.getElementById("ratioValue");
  ratioEl.textContent = (priceA != null && priceB) ? (priceA / priceB).toFixed(3) : "\u2014";

  scheduleNext(settings.refreshIntervalSecs || 15);
}

function scheduleNext(secs) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, Math.max(5, secs) * 1000);
}

document.getElementById("widgetClose").addEventListener("click", () => {
  invoke("widget_toggle", { enabled: false }).catch((e) => console.error("widget_toggle failed", e));
});

window.addEventListener("DOMContentLoaded", refresh);
