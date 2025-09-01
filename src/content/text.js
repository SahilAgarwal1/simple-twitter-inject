export const extractTweetText = (tweet) => {
  const nodes = tweet.querySelectorAll('div[data-testid="tweetText"]');
  if (nodes && nodes.length) {
    return Array.from(nodes).map(n => n.innerText || "").join("\n");
  }
  return tweet.innerText || "";
};

export const findTweets = (root = document) => root.querySelectorAll('article[role="article"]');
