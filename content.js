(function() {
  const INJECT_CLASS = "__simple_x_inject";

  // Configure your tags here (lowercase)
  const TAGS = [
    "bitcoin",
    "ethereum",
    "crypto",
    "ai",
    "sports",
    "politics",
    "stocks",
    "music",
    "gaming"
  ];

  function normalize(str) {
    return (str || "").toLowerCase();
  }

  function extractTweetText(tweet) {
    // Compose tweet text from spans/divs within the tweet text container
    // Twitter typically renders text within div[data-testid="tweetText"]
    const nodes = tweet.querySelectorAll('div[data-testid="tweetText"]');
    if (nodes && nodes.length) {
      return Array.from(nodes).map(n => n.innerText || "").join("\n");
    }
    // Fallback: use the article innerText (noisy)
    return tweet.innerText || "";
  }

  function matchTags(text) {
    const t = normalize(text);
    for (const tag of TAGS) {
      if (t.includes(tag)) return tag;
    }
    return null;
  }

  function makeBanner(matchedTag) {
    const wrap = document.createElement("div");
    wrap.className = INJECT_CLASS;
    wrap.textContent = `Matched tag: ${matchedTag}`;
    return wrap;
  }

  function findTweetContainers(root = document) {
    return root.querySelectorAll('article[role="article"]');
  }

  function injectIntoTweet(tweet) {
    if (!tweet) return;
    // If already injected, skip
    if (tweet.querySelector(`.${INJECT_CLASS}`)) return;

    const text = extractTweetText(tweet);
    const matched = matchTags(text);
    if (!matched) return; // Only inject when we have a tag hit

    const toolbar = tweet.querySelector('div[role="group"]');
    const banner = makeBanner(matched);

    if (toolbar && toolbar.parentElement) {
      toolbar.parentElement.insertBefore(banner, toolbar);
    } else {
      tweet.appendChild(banner);
    }
  }

  function scan(root) {
    findTweetContainers(root).forEach(injectIntoTweet);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => scan(document));
  } else {
    scan(document);
  }

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (!m.addedNodes) continue;
      m.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.matches && node.matches('article[role="article"]')) {
          injectIntoTweet(node);
        } else {
          scan(node);
        }
      });
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
