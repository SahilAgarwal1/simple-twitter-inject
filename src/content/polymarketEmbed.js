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
  // Normalize timestamps (ms->s), sort ascending, and deduplicate by time
  const sampleMaxT = Math.max(...points.map(p => Number(p.t) || 0));
  const toSeconds = sampleMaxT > 1e10; // treat > ~Sat Nov 20 2286 as ms guard
  const cleaned = points
    .map(p => ({ time: toSeconds ? Math.floor(Number(p.t) / 1000) : Math.floor(Number(p.t)), valueRaw: Number(p.p) }))
    .filter(p => Number.isFinite(p.time) && p.time > 0 && Number.isFinite(p.valueRaw));
  cleaned.sort((a, b) => a.time - b.time);
  const dedup = [];
  let lastTime = null;
  for (const p of cleaned) {
    if (p.time === lastTime) { dedup[dedup.length - 1] = p; continue; }
    dedup.push(p); lastTime = p.time;
  }
  if (!dedup.length) return [];
  const max = Math.max(...dedup.map(p => p.valueRaw));
  let scaleFn = (v) => v; // Convert to [0,100]
  if (max <= 1) {
    scaleFn = (v) => v * 100;
  } else if (max > 100) {
    // Values likely in basis points (eg 1800.75 => 18.0075%)
    scaleFn = (v) => v / 100;
  }
  return dedup.map(pt => ({ time: pt.time, value: Number(scaleFn(pt.valueRaw).toFixed(2)) }));
}

function ensureVisibleRange(points) {
  if (!Array.isArray(points) || points.length === 0) return points;
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const v = Number(p?.value);
    if (Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || points.length < 2) return points;
  if (Math.abs(max - min) < 1e-9) {
    // Series is flat (e.g., stuck at 0% or 100%). Nudge first point slightly within bounds
    const eps = max <= 0 ? 0.05 : (max >= 100 ? -1 : 1);
    points = points.slice();
    points[0] = { ...points[0], value: Math.max(0, Math.min(100, Number(points[0].value) + eps)) };
  }
  return points;
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

function extractYesPriceCents(market) {
  // Return a number in [0,100], possibly fractional
  const outcomes = parseMaybeJsonArray(market?.outcomes);
  const prices = parseMaybeJsonArray(market?.outcomePrices);
  const normalize = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (n <= 1) return n * 100;
    if (n > 100) return n / 100;
    return n;
  };
  if (outcomes.length && prices.length && outcomes.length === prices.length) {
    let idx = outcomes.findIndex(o => /yes/i.test(String(o)));
    if (idx < 0) idx = 0;
    const val = normalize(prices[idx]);
    if (val !== null) return Math.min(100, Math.max(0, val));
  }
  const bestBid = Number(market?.bestBid);
  const bestAsk = Number(market?.bestAsk);
  let mid = Number.isFinite(bestBid) && Number.isFinite(bestAsk) && bestAsk > 0 ? (bestBid + bestAsk) / 2 : Number(market?.lastTradePrice);
  const val = normalize(mid);
  if (val !== null) return Math.min(100, Math.max(0, val));
  const pct = extractYesPercent(market);
  return pct === null ? null : pct;
}

function formatCents(value) {
  if (!Number.isFinite(value)) return "--";
  // Show one decimal if meaningful (e.g., 7.3c)
  const v = Math.max(0, Math.min(100, value));
  const rounded1 = Math.round(v * 10) / 10;
  const isInt = Math.abs(rounded1 - Math.round(rounded1)) < 1e-9;
  return isInt ? `${Math.round(rounded1)}c` : `${rounded1.toFixed(1)}c`;
}

export function renderPolymarketEmbed(event) {
  const root = document.createElement("div");
  root.className = "__simple_x_inject";

  // Markets (used for header % in single-market events and for list rendering)
  const mkts = Array.isArray(event?.markets) ? event.markets.slice() : [];
  const isSingleMarket = mkts.length === 1;

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.gap = "10px";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.width = "100%";
  header.style.marginBottom = "6px";

  const headerLeft = document.createElement("div");
  headerLeft.style.display = "flex";
  headerLeft.style.gap = "10px";
  headerLeft.style.alignItems = "center";

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
    headerLeft.appendChild(img);
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
  headerLeft.appendChild(headerText);

  header.appendChild(headerLeft);

  if (isSingleMarket) {
    const yesPriceHeader = extractYesPriceCents(mkts[0]);
    const pctEl = document.createElement("div");
    pctEl.style.fontWeight = "800";
    pctEl.style.fontSize = "16px";
    pctEl.style.minWidth = "56px";
    pctEl.style.textAlign = "right";
    pctEl.textContent = Number.isFinite(yesPriceHeader) ? `${Math.round(yesPriceHeader)}%` : "--";
    header.appendChild(pctEl);
  }

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

  // Description intentionally omitted in embed

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

  // Chart lives before market list
  root.appendChild(chartContainer);
  // No description appended

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
          lineWidth: 1,
          topColor: "rgba(61,214,140,0.25)",
          bottomColor: "rgba(61,214,140,0.0)",
          priceFormat: {
            type: "custom",
            minMove: 0.01,
            formatter: (v) => `${v.toFixed(2)}%`,
          },
        });
        // Hide last value price line/label (the green badge in the chart)
        series.applyOptions({ lastValueVisible: false, priceLineVisible: false });
        // Lock scroll/zoom interactions
        chart.applyOptions({ handleScroll: false, handleScale: false, timeScale: { borderVisible: false } });

        // Timeframe controls
        const tfRow = document.createElement("div");
        tfRow.style.display = "flex";
        tfRow.style.gap = "6px";
        tfRow.style.marginTop = "8px";
        const tfs = [
          { key: "1H", seconds: 60 * 60, interval: "1h", fidelity: 1 },
          { key: "6H", seconds: 6 * 60 * 60, interval: "1h", fidelity: 1 },
          { key: "1D", seconds: 24 * 60 * 60, interval: "1d", fidelity: 1 },
          { key: "1W", seconds: 7 * 24 * 60 * 60, interval: "1w", fidelity: 5 },
          { key: "1M", seconds: 30 * 24 * 60 * 60, interval: "1w", fidelity: 5 },
          { key: "ALL", seconds: null, interval: "1w", fidelity: 5 },
        ];
        let current = "1W";

        function styleTf(btn, active) {
          btn.style.background = active ? "#1f2937" : "transparent";
          btn.style.color = "#9ca3af";
          btn.style.border = "1px solid rgba(255,255,255,0.08)";
          btn.style.borderRadius = "6px";
          btn.style.padding = "4px 8px";
          btn.style.fontSize = "12px";
          btn.style.cursor = "pointer";
        }

        async function loadTimeframe(tf) {
          try {
            chartStatus.textContent = "Loading chart…";
            chartStatus.style.display = "block";
            const now = Math.floor(Date.now() / 1000);
            const startTs = tf.seconds == null ? undefined : (now - tf.seconds);
            const raw2 = await fetchPriceHistory(tokenId, { interval: tf.interval, fidelity: tf.fidelity, startTs });
            let data2 = normalizeToPercent(raw2);
            data2 = ensureVisibleRange(data2);
            // Guard against rare duplicate-last-point artifacts by nudging last timestamp forward by 1s
            if (data2.length > 1 && data2[data2.length - 1].time <= data2[data2.length - 2].time) {
              data2[data2.length - 1].time = data2[data2.length - 2].time + 1;
            }
            series.setData(data2);
            chart.timeScale().fitContent();
            chartStatus.style.display = "none";
          } catch (_) {
            chartStatus.textContent = "Chart unavailable";
          }
        }

        const buttons = [];
        tfs.forEach(tf => {
          const b = document.createElement("button");
          b.textContent = tf.key;
          styleTf(b, tf.key === current);
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            current = tf.key;
            buttons.forEach(x => styleTf(x.el, x.tf.key === current));
            loadTimeframe(tf);
          });
          buttons.push({ el: b, tf });
          tfRow.appendChild(b);
        });

        // Initial data and controls
        series.setData(ensureVisibleRange(data));
        chart.timeScale().fitContent();
        // Place timeframe buttons outside the chart container so they are visible
        root.appendChild(tfRow);

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

  // No description toggle

  // Sub-markets list
  if (mkts.length) {
    if (isSingleMarket) {
      // Render only the buttons full-width
      const m = mkts[0];
      const yesPrice = extractYesPriceCents(m);
      const btns = document.createElement("div");
      btns.style.display = "grid";
      btns.style.gridTemplateColumns = "1fr 1fr";
      btns.style.gap = "12px";
      btns.style.marginTop = "10px";

      function makeBtn(text, bg) {
        const b = document.createElement("button");
        b.textContent = text;
        b.style.background = bg;
        b.style.color = "#dfe7e4";
        b.style.border = "none";
        b.style.borderRadius = "12px";
        b.style.height = "40px";
        b.style.padding = "0 16px";
        b.style.width = "100%";
        b.style.fontWeight = "800";
        b.style.cursor = "pointer";
        b.style.whiteSpace = "nowrap";
        b.style.boxShadow = "inset 0 0 0 1px rgba(255,255,255,0.06)";
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          const slug = m?.slug || event?.slug;
          if (slug) window.open(`https://polymarket.com/market/${encodeURIComponent(slug)}`, "_blank");
        });
        return b;
      }

      const yesBtn = makeBtn(`Buy Yes ${formatCents(yesPrice)}`, "#265a4a");
      const noPrice = Number.isFinite(yesPrice) ? 100 - yesPrice : null;
      const noBtn = makeBtn(`Buy No ${formatCents(noPrice)}`, "#5a2a33");
      btns.appendChild(yesBtn);
      btns.appendChild(noBtn);
      root.appendChild(btns);
      return root;
    }
    // Sort by descending probability
    mkts.sort((a, b) => {
      const ay = extractYesPercent(a);
      const by = extractYesPercent(b);
      if (Number.isFinite(ay) && Number.isFinite(by)) return by - ay;
      if (Number.isFinite(ay)) return -1;
      if (Number.isFinite(by)) return 1;
      const al = Number(a?.liquidityClob || 0) + Number(a?.liquidityAmm || 0);
      const bl = Number(b?.liquidityClob || 0) + Number(b?.liquidityAmm || 0);
      return bl - al;
    });
    const list = document.createElement("div");
    list.style.display = "grid";
    list.style.gridTemplateColumns = "1fr";
    list.style.gap = "8px";
    list.style.marginTop = "10px";
    const rows = [];
    const hiddenRows = [];
    for (const m of mkts) {
      const row = document.createElement("div");
      row.style.display = "grid";
      row.style.gridTemplateColumns = "1fr 56px 240px"; // label | % | fixed buttons area
      row.style.alignItems = "center";
      row.style.columnGap = "10px";
      row.style.padding = "8px 10px";
      row.style.border = "1px solid rgba(0,0,0,0.08)";
      row.style.borderRadius = "8px";

      const left = document.createElement("div");
      left.style.display = "flex";
      left.style.alignItems = "center";
      left.style.gap = "8px";

      if (m?.icon || m?.image) {
        const marketImgSrc = m.icon || m.image;
        // Only render if distinct from the event image
        if (marketImgSrc && marketImgSrc !== imgUrl) {
          const mi = document.createElement("img");
          mi.src = marketImgSrc;
          mi.alt = "";
          mi.referrerPolicy = "no-referrer";
          mi.style.width = "20px";
          mi.style.height = "20px";
          mi.style.objectFit = "cover";
          mi.style.borderRadius = "4px";
          left.appendChild(mi);
        }
      }

      const label = document.createElement("div");
      // Prefer groupItemTitle explicitly; fall back only if null/undefined
      label.textContent = String((m?.groupItemTitle ?? m?.question ?? m?.title ?? ""));
      label.style.fontWeight = "500";
      left.appendChild(label);

      const yesPrice = extractYesPriceCents(m);

      const mid = document.createElement("div");
      mid.style.fontWeight = "800";
      mid.style.textAlign = "center";
      mid.style.fontSize = "18px";
      mid.style.minWidth = "56px";
      mid.textContent = Number.isFinite(yesPrice) ? `${Math.round(yesPrice)}%` : "--";

      const btns = document.createElement("div");
      btns.style.display = "grid";
      btns.style.gridTemplateColumns = "1fr 1fr";
      btns.style.gap = "8px";
      btns.style.width = "240px"; // enforce consistent button width across rows

      function makeBtn(text, bg) {
        const b = document.createElement("button");
        b.textContent = text;
        // Softer, muted backgrounds closer to the reference, with lighter text
        b.style.background = bg;
        b.style.color = "#dfe7e4";
        b.style.border = "none";
        b.style.borderRadius = "12px";
        b.style.height = "36px";
        b.style.padding = "0 12px";
        b.style.width = "100%";
        b.style.fontWeight = "800";
        b.style.cursor = "pointer";
        b.style.whiteSpace = "nowrap";
        b.style.boxShadow = "inset 0 0 0 1px rgba(255,255,255,0.06)";
        b.onmouseenter = () => { b.style.filter = "brightness(1.02)"; };
        b.onmouseleave = () => { b.style.filter = "none"; };
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          const slug = m?.slug || event?.slug;
          if (slug) window.open(`https://polymarket.com/market/${encodeURIComponent(slug)}`, "_blank");
        });
        return b;
      }

      const yesBtn = makeBtn(`Buy Yes ${formatCents(yesPrice)}`, "#265a4a");
      const noPrice = Number.isFinite(yesPrice) ? 100 - yesPrice : null;
      const noBtn = makeBtn(`Buy No ${formatCents(noPrice)}`, "#5a2a33");

      btns.appendChild(yesBtn);
      btns.appendChild(noBtn);

      row.appendChild(left);
      row.appendChild(mid);
      row.appendChild(btns);

      row.style.cursor = "pointer";
      row.addEventListener("click", (e) => {
        const slug = m?.slug || event?.slug;
        if (slug) window.open(`https://polymarket.com/market/${encodeURIComponent(slug)}`, "_blank");
      });

      rows.push(row);
    }

    // Show only top 3 rows initially
    const MAX_VISIBLE = 3;
    if (rows.length > MAX_VISIBLE) {
      rows.slice(0, MAX_VISIBLE).forEach(r => list.appendChild(r));
      rows.slice(MAX_VISIBLE).forEach(r => hiddenRows.push(r));
      const toggleMore = document.createElement("button");
      toggleMore.textContent = `Show more (${rows.length - MAX_VISIBLE})`;
      toggleMore.style.background = "transparent";
      toggleMore.style.border = "none";
      toggleMore.style.color = "#3dd68c";
      toggleMore.style.cursor = "pointer";
      toggleMore.style.padding = "0";
      toggleMore.style.marginTop = "6px";
      toggleMore.style.fontWeight = "600";
    let expanded = false;
      toggleMore.addEventListener("click", (e) => {
        e.stopPropagation();
      expanded = !expanded;
      if (expanded) {
          hiddenRows.forEach(r => list.appendChild(r));
          toggleMore.textContent = "Show less";
      } else {
          hiddenRows.forEach(r => { if (r.parentElement === list) list.removeChild(r); });
          toggleMore.textContent = `Show more (${rows.length - MAX_VISIBLE})`;
        }
      });
      root.appendChild(list);
      root.appendChild(toggleMore);
    } else {
      rows.forEach(r => list.appendChild(r));
      root.appendChild(list);
    }
  }

  return root;
}


