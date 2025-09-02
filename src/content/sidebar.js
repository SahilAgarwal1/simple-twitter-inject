// Minimal sidebar utilities and Breaking News insertion

function findSidebarColumn() {
  try {
    return (
      document.querySelector('div[data-testid="sidebarColumn"]') ||
      document.querySelector('aside[role="complementary"]') ||
      null
    );
  } catch (_) {
    return null;
  }
}

export function ensureBreakingNewsBox() {
  const sidebar = findSidebarColumn();
  if (!sidebar || sidebar.querySelector(".__simple_x_breaking_news")) return;

  const anchorHeading = Array.from(sidebar.querySelectorAll("h2, [role=heading]"))
    .find(h => /live on x|today|what.?s happening|trending now|who to follow/i.test(String(h.textContent || "").trim()));
  if (!anchorHeading) return;

  let moduleWrapper = anchorHeading.closest(".r-kemksi.r-1kqtdi0") || anchorHeading.closest("section") || anchorHeading.closest("div[role=region]") || anchorHeading.parentElement;
  if (!moduleWrapper || !moduleWrapper.parentElement) return;

  const clone = moduleWrapper.cloneNode(true);
  clone.classList.add("__simple_x_breaking_news");

  const h = clone.querySelector("h2, [role=heading]");
  if (h) h.textContent = "Breaking news";

  if (h) {
    const headerRow = h.closest("div") || clone.firstElementChild;
    if (headerRow) {
      let n = headerRow.nextSibling;
      while (n) { const next = n.nextSibling; n.remove(); n = next; }
    }
  }
  const placeholder = document.createElement("div");
  placeholder.textContent = "No breaking news yet";
  placeholder.style.opacity = "0.7";
  placeholder.style.padding = "12px 16px";
  clone.appendChild(placeholder);

  moduleWrapper.parentElement.insertBefore(clone, moduleWrapper);
}

// Expose tiny manual hook for debugging
// eslint-disable-next-line no-unused-vars
window.__simpleX_insertBreakingNews = () => ensureBreakingNewsBox();


