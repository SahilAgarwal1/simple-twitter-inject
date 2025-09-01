import { findTweets, extractTweetText } from "./text";
import { alreadyInjected, injectBanner } from "./inject";
import { renderPolymarketEmbed } from "./polymarketEmbed";

const requestEmbedding = (id, text) => new Promise((resolve) => {
  chrome.runtime.sendMessage({ type: "embed", id, text }, (resp) => {
    resolve(resp || { ok: false, error: "no response" });
  });
});

const scan = async (root = document) => {
  const tweets = findTweets(root);
  for (const tweet of tweets) {
    if (alreadyInjected(tweet)) continue;
    const text = extractTweetText(tweet);
    const id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random());
    const start = performance.now();
    const resp = await requestEmbedding(id, text);
    const elapsed = Math.round(performance.now() - start);
    let label = "Embedding failed";
    if (resp && resp.ok) {
      const { embedMs, modelLoadMs = 0, dim, topMarket } = resp;
      label = `Embedding: ${embedMs} ms (req: ${elapsed} ms) • dim=${dim}${modelLoadMs ? ` • modelLoad=${modelLoadMs} ms` : ""}`;
      if (resp.market) {
        const embed = renderPolymarketEmbed(resp.market);
        injectBanner(tweet, label);
        tweet.querySelector(".__simple_x_inject").appendChild(embed);
        continue;
      }
    } else if (resp && resp.error) {
      label = `Error: ${resp.error}`;
    }
    injectBanner(tweet, label);
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
