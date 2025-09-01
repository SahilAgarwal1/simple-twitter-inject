function getHideUnmatched() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get({ hideUnmatched: false }, (obj) => resolve(!!obj.hideUnmatched));
    } catch (_) {
      resolve(false);
    }
  });
}

function setHideUnmatched(value) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ hideUnmatched: !!value }, () => resolve(true));
    } catch (_) {
      resolve(false);
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const checkbox = document.getElementById("hideUnmatched");
  checkbox.checked = await getHideUnmatched();
  checkbox.addEventListener("change", async () => {
    await setHideUnmatched(checkbox.checked);
  });
});


