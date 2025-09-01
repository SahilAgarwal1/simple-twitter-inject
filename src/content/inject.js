const INJECT_CLASS = "__simple_x_inject";

export const alreadyInjected = (tweet) =>
  !!tweet.dataset.simpleXProcessed || !!tweet.querySelector(`.${INJECT_CLASS}`);

export const markProcessed = (tweet) => {
  if (tweet && tweet instanceof Element) {
    tweet.dataset.simpleXProcessed = "1";
  }
};

export const injectBanner = (tweet, label) => {
  const banner = document.createElement("div");
  banner.className = INJECT_CLASS;
  banner.textContent = String(label);
  const toolbar = tweet.querySelector('div[role="group"]');
  if (toolbar && toolbar.parentElement) {
    toolbar.parentElement.insertBefore(banner, toolbar);
  } else {
    tweet.appendChild(banner);
  }
};
