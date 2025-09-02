import { createChart } from "lightweight-charts";

const API_BASE = "https://gamma-api.polymarket.com";
const CLOB_BASE = "https://clob.polymarket.com";

export async function fetchEventById(id) {
  const resp = await fetch(`${API_BASE}/events/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });
  if (!resp.ok) throw new Error(`Gamma get event failed: ${resp.status}`);
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

function pickPrimaryMarketFromEvent(event) {
  const markets = Array.isArray(event?.markets) ? event.markets : [];
  if (!markets.length) return null;
  // Prefer market with highest liquidityClob + liquidityAmm (fallback to first)
  let best = markets[0];
  let bestScore = Number(best?.liquidityClob || 0) + Number(best?.liquidityAmm || 0);
  for (let i = 1; i < markets.length; i++) {
    const m = markets[i];
    const score = Number(m?.liquidityClob || 0) + Number(m?.liquidityAmm || 0);
    if (score > bestScore) { best = m; bestScore = score; }
  }
  return best;
}

function extractYesPercent(market) {
  // Try outcomePrices aligned with outcomes
  const outcomes = parseMaybeJsonArray(market?.outcomes);
  const prices = parseMaybeJsonArray(market?.outcomePrices);
  if (outcomes.length && prices.length && outcomes.length === prices.length) {
    let idx = outcomes.findIndex(o => /yes/i.test(String(o)));
    if (idx < 0) idx = 0;
    const raw = Number(prices[idx]);
    if (Number.isFinite(raw)) {
      if (raw <= 1) return Math.round(raw * 100);
      if (raw > 100) return Math.round(raw / 100);
      return Math.round(raw);
    }
  }
  // Fallback to mid of best bid/ask or last trade
  const bestBid = Number(market?.bestBid);
  const bestAsk = Number(market?.bestAsk);
  let mid = Number.isFinite(bestBid) && Number.isFinite(bestAsk) && bestAsk > 0 ? (bestBid + bestAsk) / 2 : Number(market?.lastTradePrice);
  if (Number.isFinite(mid)) {
    if (mid <= 1) return Math.round(mid * 100);
    if (mid > 100) return Math.round(mid / 100);
    return Math.round(mid);
  }
  return null;
}

export function renderPolymarketEmbed(event) {
  const root = document.createElement("div");
  root.className = "__simple_x_inject";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.gap = "10px";
  header.style.alignItems = "center";
  header.style.marginBottom = "6px";

  const imgUrl = event?.icon || event?.image || event?.featuredImage;
  if (imgUrl) {
    const img = document.createElement("img");
    img.src = imgUrl;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.style.width = "36px";
    img.style.height = "36px";
    img.style.objectFit = "cover";
    img.style.borderRadius = "8px";
    img.style.flex = "0 0 auto";
    header.appendChild(img);
  }

  const headerText = document.createElement("div");
  headerText.style.display = "flex";
  headerText.style.flexDirection = "column";

  const title = document.createElement("div");
  title.style.fontWeight = "600";
  const sim = typeof event?._similarity === "number" ? `  •  ${(event._similarity).toFixed(2)}` : "";
  title.textContent = `${event?.title || "Polymarket"}${sim}`;

  const meta = document.createElement("div");
  meta.style.opacity = "0.8";
  meta.style.marginTop = "2px";
  const cat = event?.category ? `• ${event.category}` : "";
  meta.textContent = [cat].filter(Boolean).join("  ");

  headerText.appendChild(title);
  headerText.appendChild(meta);
  header.appendChild(headerText);

  // Outcomes grid removed to simplify header

  const chartContainer = document.createElement("div");
  chartContainer.style.marginTop = "8px";
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
  desc.style.marginTop = "8px";
  desc.style.display = "-webkit-box";
  desc.style.webkitBoxOrient = "vertical";
  desc.style.webkitLineClamp = "2";
  desc.style.overflow = "hidden";
  desc.style.textOverflow = "ellipsis";
  desc.textContent = event?.description || "";

  const toggle = document.createElement("button");
  toggle.textContent = "Show more";
  toggle.style.display = "none";
  toggle.style.background = "transparent";
  toggle.style.border = "none";
  toggle.style.color = "#3dd68c";
  toggle.style.cursor = "pointer";
  toggle.style.padding = "0";
  toggle.style.marginTop = "4px";

  root.appendChild(header);
  // If matches list is provided (lightweight mode), render list and skip chart/detail
  if (Array.isArray(event?.matches) && event.matches.length) {
    const list = document.createElement("div");
    list.style.display = "grid";
    list.style.gridTemplateColumns = "1fr";
    list.style.gap = "6px";
    for (const m of event.matches) {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.justifyContent = "space-between";
      const left = document.createElement("div");
      left.textContent = String(m?.question || m?.title || m?.id || "");
      left.style.fontWeight = "500";
      const right = document.createElement("div");
      const s = typeof m?.similarity === "number" ? m.similarity.toFixed(2) : "";
      right.textContent = s;
      right.style.opacity = "0.7";
      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
    }
    root.appendChild(list);
    return root;
  }

  // Chart lives before description
  root.appendChild(chartContainer);
  if (event?.description) root.appendChild(desc);
  if (event?.description) root.appendChild(toggle);

  // Kick off async chart load
  const primaryMarket = pickPrimaryMarketFromEvent(event);
  const tokenId = primaryMarket ? deriveTokenId(primaryMarket) : null;
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
          layout: { attributionLogo: false, background: { color: "transparent" }, textColor: "#666" },
          grid: { vertLines: { color: "rgba(0,0,0,0.07)" }, horzLines: { color: "rgba(0,0,0,0.07)" } },
          rightPriceScale: { visible: true, borderVisible: false },
          timeScale: { borderVisible: false },
          watermark: { visible: false },
        });
        const series = chart.addAreaSeries({
          lineColor: "#3dd68c",
          topColor: "rgba(61,214,140,0.25)",
          bottomColor: "rgba(61,214,140,0.0)",
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

  if (event?.description) {
    queueMicrotask(() => {
      const isOverflowing = desc.scrollHeight > desc.clientHeight + 1;
      toggle.style.display = isOverflowing ? "inline" : "none";
    });
    let expanded = false;
    toggle.addEventListener("click", () => {
      expanded = !expanded;
      if (expanded) {
        desc.style.webkitLineClamp = "";
        desc.style.display = "block";
        toggle.textContent = "Show less";
      } else {
        desc.style.display = "-webkit-box";
        desc.style.webkitBoxOrient = "vertical";
        desc.style.webkitLineClamp = "2";
        toggle.textContent = "Show more";
      }
    });
  }

  // Sub-markets list
  const mkts = Array.isArray(event?.markets) ? event.markets.slice() : [];
  if (mkts.length) {
    mkts.sort((a, b) => (Number(b?.liquidityClob || 0) + Number(b?.liquidityAmm || 0)) - (Number(a?.liquidityClob || 0) + Number(a?.liquidityAmm || 0)));
    const list = document.createElement("div");
    list.style.display = "grid";
    list.style.gridTemplateColumns = "1fr";
    list.style.gap = "8px";
    list.style.marginTop = "10px";
    for (const m of mkts) {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.justifyContent = "space-between";
      row.style.padding = "8px 10px";
      row.style.border = "1px solid rgba(0,0,0,0.08)";
      row.style.borderRadius = "8px";

      const left = document.createElement("div");
      left.style.display = "flex";
      left.style.alignItems = "center";
      left.style.gap = "8px";

      if (m?.icon || m?.image) {
        const mi = document.createElement("img");
        mi.src = m.icon || m.image;
        mi.alt = "";
        mi.referrerPolicy = "no-referrer";
        mi.style.width = "20px";
        mi.style.height = "20px";
        mi.style.objectFit = "cover";
        mi.style.borderRadius = "4px";
        left.appendChild(mi);
      }

      const label = document.createElement("div");
      label.textContent = String(m?.groupItemTitle || m?.question || m?.title || "");
      label.style.fontWeight = "500";
      left.appendChild(label);

      const right = document.createElement("div");
      const pct = extractYesPercent(m);
      right.textContent = Number.isFinite(pct) ? `${pct}%` : "--";
      right.style.fontWeight = "700";
      right.style.color = "#16a34a";
      right.style.marginLeft = "12px";

      row.appendChild(left);
      row.appendChild(right);

      row.style.cursor = "pointer";
      row.addEventListener("click", () => {
        const slug = m?.slug || event?.slug;
        if (slug) window.open(`https://polymarket.com/market/${encodeURIComponent(slug)}`, "_blank");
      });

      list.appendChild(row);
    }
    root.appendChild(list);
  }

  return root;
}


