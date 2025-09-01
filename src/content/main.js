import { findTweets, extractTweetText } from "./text";
import { alreadyInjected, markProcessed } from "./inject";
import { renderPolymarketEmbed } from "./polymarketEmbed";

const requestEmbedding = (id, text) => new Promise((resolve) => {
  chrome.runtime.sendMessage({ type: "embed", id, text }, (resp) => {
    resolve(resp || { ok: false, error: "no response" });
  });
});

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
  const hideUnmatched = await getHideUnmatched();
  const tweets = findTweets(root);
  for (const tweet of tweets) {
    if (alreadyInjected(tweet)) continue;
    const text = extractTweetText(tweet);
    const id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
    const resp = await requestEmbedding(id, text);
    if (resp && resp.ok && resp.market) {
      const embed = renderPolymarketEmbed(resp.market);
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
    if (hideUnmatched && resp && resp.ok && !resp.market) {
      tweet.style.display = "none";
      markProcessed(tweet);
    }
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => scan(document));
} else {
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
