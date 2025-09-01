import { pipeline, env } from "@xenova/transformers";

// Configure to avoid local /models path and load assets remotely
env.allowLocalModels = false; // do not try /models/... inside the extension
env.useBrowserCache = true;   // cache in IndexedDB for speed
// Service workers cannot spawn WebWorkers; disable to avoid URL.createObjectURL
env.useWebWorker = false;
// ONNX Runtime: disable proxy worker and threading to avoid worker creation
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.numThreads = 1;
// Point ONNX Runtime wasm files to CDN (alternatively, host locally via chrome.runtime.getURL)
env.backends.onnx.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/@xenova/transformers/dist/";

let pipelinePromise = null;
let modelLoadMs = null;

async function getEmbedPipeline() {
  if (!pipelinePromise) {
    const t0 = performance.now();
    pipelinePromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    await pipelinePromise;
    modelLoadMs = Math.round(performance.now() - t0);
  }
  return pipelinePromise;
}

// Pre-warm on install/upgrade
chrome.runtime.onInstalled.addListener(() => {
  getEmbedPipeline().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "embed") {
    (async () => {
      try {
        const { id, text } = message;
        const embPipe = await getEmbedPipeline();
        const t1 = performance.now();
        const output = await embPipe(text, { pooling: "mean", normalize: true });
        const t2 = performance.now();
        const embedMs = Math.round(t2 - t1);
        const dim = output?.data?.length || 0;
        sendResponse({ ok: true, id, embedMs, modelLoadMs: modelLoadMs ?? 0, dim });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true; // async response
  }
});
