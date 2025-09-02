import { findTweets, extractTweetText } from "./text";
import { alreadyInjected, markProcessed } from "./inject";
import { renderPolymarketEmbed } from "./polymarketEmbed";
import { ensureBreakingNewsBox } from "./sidebar";

// Lightweight LRU+TTL cache for embedding results to avoid re-querying on scroll
const MAX_CACHE_ENTRIES = 500;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const responseCache = new Map(); // key -> { ts, value }
const inflight = new Map(); // key -> Promise

function hashText(text) {
  // FNV-1a 32-bit
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = (hash >>> 0) * 16777619 >>> 0;
  }
  return String(hash >>> 0);
}

function getCached(key) {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  // refresh LRU recency
  responseCache.delete(key);
  responseCache.set(key, entry);
  return entry.value;
}

function setCached(key, value) {
  responseCache.set(key, { ts: Date.now(), value });
  if (responseCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey !== undefined) responseCache.delete(oldestKey);
  }
}

const requestEmbedding = (id, text) => {
  const key = hashText(String(text || ""));
  const cached = getCached(key);
  if (cached) return Promise.resolve(cached);
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = new Promise((resolve) => {
    let settled = false;
    const done = (out) => {
      if (settled) return;
      settled = true;
      setCached(key, out);
      inflight.delete(key);
      resolve(out);
    };
    // Safety timeout in case the worker reloaded
    const to = setTimeout(() => done({ ok: false, error: "timeout" }), 5000);
    try {
      if (chrome?.runtime?.id) {
        chrome.runtime.sendMessage({ type: "embed", id, text }, (resp) => {
          clearTimeout(to);
          const out = resp || { ok: false, error: chrome?.runtime?.lastError?.message || "no response" };
          done(out);
        });
      } else {
        clearTimeout(to);
        done({ ok: false, error: "extension-context-missing" });
      }
    } catch (e) {
      clearTimeout(to);
      done({ ok: false, error: String(e && e.message || e) });
    }
  });
  inflight.set(key, p);
  return p;
};

// Sidebar logic moved to ./sidebar

function getHideUnmatched() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get({ hideUnmatched: false }, (obj) => resolve(!!obj.hideUnmatched));
    } catch (_) {
      resolve(false);
    }
  });
}

const scan = async (root = document) => {
  // Keep the sidebar box in place
  ensureBreakingNewsBox();
  const hideUnmatched = await getHideUnmatched();
  const tweets = findTweets(root);
  for (const tweet of tweets) {
    if (alreadyInjected(tweet)) continue;
    const text = extractTweetText(tweet);
    const id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
    const resp = await requestEmbedding(id, text);
    if (resp && resp.ok && Array.isArray(resp.matches) && resp.matches.length) {
      // If the worker already fetched a full event (CORS-safe), prefer rendering it
      if (resp.event && typeof resp.event === "object") {
        const embed = renderPolymarketEmbed(resp.event);
        const toolbar = tweet.querySelector('div[role="group"]');
        if (toolbar && toolbar.parentElement) {
          toolbar.parentElement.insertBefore(embed, toolbar);
        } else {
          tweet.appendChild(embed);
        }
        markProcessed(tweet);
        continue;
      }

      // Fallback: render the matches list
      const embed = renderPolymarketEmbed({ title: "Matches", matches: resp.matches });
      const toolbar = tweet.querySelector('div[role="group"]');
      if (toolbar && toolbar.parentElement) {
        toolbar.parentElement.insertBefore(embed, toolbar);
      } else {
        tweet.appendChild(embed);
      }
      markProcessed(tweet);
      continue;
    }
    // Only hide when feature is on, request succeeded, but no market was matched
    if (hideUnmatched && resp && resp.ok && (!resp.matches || !resp.matches.length)) {
      tweet.style.display = "none";
      markProcessed(tweet);
    }
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    ensureBreakingNewsBox();
    scan(document);
  });
} else {
  ensureBreakingNewsBox();
  scan(document);
}

new MutationObserver(mutations => {
  for (const m of mutations) {
    if (!m.addedNodes) continue;
    m.addedNodes.forEach(node => {
      if (!(node instanceof Element)) return;
      if (node.matches && node.matches('article[role="article"]')) {
        scan(node);
      } else {
        scan(node);
      }
    });
  }
}).observe(document.documentElement, { childList: true, subtree: true });

// React to toggle changes: rescan and show tweets again if needed
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.hideUnmatched) return;
  const enabled = !!changes.hideUnmatched.newValue;
  if (!enabled) {
    // Unhide any previously hidden tweets and clear processed marker
    findTweets(document).forEach(t => {
      if (t && t.style && t.style.display === "none") t.style.display = "";
      if (t && t.dataset) delete t.dataset.simpleXProcessed;
    });
  }
  scan(document);
});
