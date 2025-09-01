const API_BASE = "https://gamma-api.polymarket.com";

export async function fetchMarketById(id) {
  const resp = await fetch(`${API_BASE}/markets/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { "Accept": "application/json" },
  });
  if (!resp.ok) throw new Error(`Gamma get market failed: ${resp.status}`);
  return await resp.json();
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
  const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : [];
  const outcomePrices = Array.isArray(market?.outcomePrices) ? market.outcomePrices : [];
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
  if (market?.description) root.appendChild(desc);
  root.appendChild(link);

  return root;
}


