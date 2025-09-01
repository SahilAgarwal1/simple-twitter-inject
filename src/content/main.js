import { findTweets, extractTweetText } from "./text";
import { alreadyInjected } from "./inject";
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
    const resp = await requestEmbedding(id, text);
    if (resp && resp.ok && resp.market) {
      const embed = renderPolymarketEmbed(resp.market);
      const toolbar = tweet.querySelector('div[role="group"]');
      if (toolbar && toolbar.parentElement) {
        toolbar.parentElement.insertBefore(embed, toolbar);
      } else {
        tweet.appendChild(embed);
      }
      continue;
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
