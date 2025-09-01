import { createChart } from "lightweight-charts";

const API_BASE = "https://gamma-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";

export async function fetchMarketById(id) {
  const resp = await fetch(`${API_BASE}/markets/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });
  if (!resp.ok) throw new Error(`Gamma get market failed: ${resp.status}`);
  return await resp.json();
}

async function fetchPriceHistory(tokenId, { interval = "1w", fidelity = 5, startTs, endTs } = {}) {
  const params = new URLSearchParams();
  params.set("market", String(tokenId));
  if (interval) params.set("interval", interval);
  if (typeof fidelity === "number") params.set("fidelity", String(fidelity));
  if (startTs) params.set("startTs", String(startTs));
  if (endTs) params.set("endTs", String(endTs));
  const url = `${CLOB_BASE}/prices-history?${params.toString()}`;
  const resp = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!resp.ok) throw new Error(`CLOB price history failed: ${resp.status}`);
  const data = await resp.json();
  const history = Array.isArray(data?.history) ? data.history : [];
  return history.map(pt => ({ t: Number(pt.t), p: Number(pt.p) })).filter(pt => Number.isFinite(pt.t) && Number.isFinite(pt.p));
}

function parseMaybeJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function deriveTokenId(market) {
  // Try common shapes
  if (!market || typeof market !== "object") return null;
  // Gamma often returns string-encoded arrays
  const outcomes = parseMaybeJsonArray(market.outcomes);
  const clobIds = parseMaybeJsonArray(market.clobTokenIds);
  if (clobIds.length) {
    if (outcomes.length) {
      const yesIdx = Math.max(0, outcomes.findIndex(o => /yes/i.test(String(o))));
      return clobIds[yesIdx >= 0 ? yesIdx : 0] || clobIds[0] || null;
    }
    return clobIds[0] || null;
  }
  if (market.tokenId) return market.tokenId;
  if (market.marketToken) return market.marketToken;
  if (market.yesTokenId) return market.yesTokenId;
  if (market.noTokenId) return market.noTokenId;
  if (Array.isArray(market.outcomeTokenIds) && market.outcomeTokenIds.length) return market.outcomeTokenIds[0];
  if (Array.isArray(market.tokens) && market.tokens.length) {
    // Prefer a YES token if present; else first token
    const yesLike = market.tokens.find(t => /yes/i.test(String(t?.outcome || t?.name || "")));
    const chosen = yesLike || market.tokens[0];
    return chosen?.tokenId || chosen?.id || null;
  }
  if (Array.isArray(market.outcomeTokens) && market.outcomeTokens.length) {
    const yesLike = market.outcomeTokens.find(t => /yes/i.test(String(t?.outcome || t?.name || "")));
    const chosen = yesLike || market.outcomeTokens[0];
    return chosen?.tokenId || chosen?.id || null;
  }
  // Not found
  return null;
}

function normalizeToPercent(points) {
  if (!points.length) return [];
  const max = Math.max(...points.map(p => p.p));
  // Convert to [0,100]
  let scaleFn = (v) => v;
  if (max <= 1) {
    scaleFn = (v) => v * 100;
  } else if (max > 100) {
    // Values likely in basis points (eg 1800.75 => 18.0075%)
    scaleFn = (v) => v / 100;
  }
  return points.map(pt => ({ time: pt.t, value: Number(scaleFn(pt.p).toFixed(2)) }));
}

export function renderPolymarketEmbed(market) {
  const root = document.createElement("div");
  root.className = "__simple_x_inject";

  const title = document.createElement("div");
  title.style.fontWeight = "600";
  title.style.marginBottom = "6px";
  title.textContent = market?.question || "Polymarket";

  const meta = document.createElement("div");
  meta.style.opacity = "0.8";
  meta.style.marginBottom = "8px";
  const cat = market?.category ? `• ${market.category}` : "";
  const ends = market?.endDate ? `• Ends: ${new Date(market.endDate).toLocaleString()}` : "";
  meta.textContent = [cat, ends].filter(Boolean).join("  ");

  const prices = document.createElement("div");
  const outcomes = parseMaybeJsonArray(market?.outcomes);
  const outcomePrices = parseMaybeJsonArray(market?.outcomePrices);
  prices.style.display = "grid";
  prices.style.gridTemplateColumns = "1fr auto";
  prices.style.gap = "6px 12px";
  prices.style.marginBottom = "8px";
  for (let i = 0; i < outcomes.length; i++) {
    const o = document.createElement("div");
    o.textContent = String(outcomes[i]);
    const p = document.createElement("div");
    p.style.textAlign = "right";
    const val = Number(outcomePrices[i] ?? 0);
    p.textContent = isFinite(val) ? `${(val * 100).toFixed(1)}%` : "";
    prices.appendChild(o);
    prices.appendChild(p);
  }

  const chartContainer = document.createElement("div");
  chartContainer.style.marginTop = outcomes.length ? "8px" : "0px";
  chartContainer.style.height = "140px";
  chartContainer.style.width = "100%";
  chartContainer.style.position = "relative";
  chartContainer.style.border = "1px solid rgba(0,0,0,0.08)";
  chartContainer.style.borderRadius = "8px";
  chartContainer.style.overflow = "hidden";
  const chartStatus = document.createElement("div");
  chartStatus.textContent = "Loading chart…";
  chartStatus.style.fontSize = "12px";
  chartStatus.style.opacity = "0.7";
  chartStatus.style.position = "absolute";
  chartStatus.style.top = "8px";
  chartStatus.style.left = "10px";
  chartContainer.appendChild(chartStatus);

  const desc = document.createElement("div");
  desc.style.marginTop = "6px";
  desc.style.maxHeight = "80px";
  desc.style.overflow = "hidden";
  desc.style.textOverflow = "ellipsis";
  desc.textContent = market?.description || "";

  const link = document.createElement("a");
  link.href = market?.slug ? `https://polymarket.com/market/${market.slug}` : "https://polymarket.com";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.display = "inline-block";
  link.style.marginTop = "8px";
  link.style.color = "#1d9bf0";
  link.textContent = "View on Polymarket";

  root.appendChild(title);
  root.appendChild(meta);
  if (outcomes.length) root.appendChild(prices);
  // Chart lives before description/link
  root.appendChild(chartContainer);
  if (market?.description) root.appendChild(desc);
  root.appendChild(link);

  // Kick off async chart load
  const tokenId = deriveTokenId(market);
  if (tokenId) {
    // Defer to ensure element is in DOM for accurate sizing
    queueMicrotask(async () => {
      try {
        const raw = await fetchPriceHistory(tokenId, { interval: "1w", fidelity: 5 });
        const data = normalizeToPercent(raw);
        chartStatus.remove();
        const initialWidth = Math.max(chartContainer.clientWidth || 480, 240);
        const chart = createChart(chartContainer, {
          width: initialWidth,
          height: 140,
          layout: { background: { color: "transparent" }, textColor: "#666" },
          grid: { vertLines: { color: "rgba(0,0,0,0.07)" }, horzLines: { color: "rgba(0,0,0,0.07)" } },
          rightPriceScale: { visible: true, borderVisible: false },
          timeScale: { borderVisible: false },
          watermark: { visible: false },
        });
        const series = chart.addAreaSeries({
          lineColor: "#1d9bf0",
          topColor: "rgba(29,155,240,0.25)",
          bottomColor: "rgba(29,155,240,0.0)",
          priceFormat: {
            type: "custom",
            minMove: 0.01,
            formatter: (v) => `${v.toFixed(2)}%`,
          },
        });
        series.setData(data);
        // Fit the visible range to the loaded data
        chart.timeScale().fitContent();

        const ro = new ResizeObserver(entries => {
          for (const entry of entries) {
            const w = Math.max(Math.floor(entry.contentRect.width), 240);
            if (w > 0) chart.applyOptions({ width: w });
            // Keep view fitted after container resizes
            chart.timeScale().fitContent();
          }
        });
        ro.observe(chartContainer);
      } catch (e) {
        chartStatus.textContent = "Chart unavailable";
      }
    });
  } else {
    chartStatus.textContent = "Chart unavailable";
  }

  return root;
}


