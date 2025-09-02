import { pipeline, env } from "@xenova/transformers";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

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
let supabase = null;
const GAMMA_API = "https://gamma-api.polymarket.com";

function getSupabase() {
  if (!supabase) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.warn("[worker] Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars");
    } else {
      supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: "public" } });
    }
  }
  return supabase;
}

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
        const vector = Array.from(output?.data || []);
        const dim = vector.length || 0;

        // Query Supabase RPC for top markets (return 3)
        let matches = [];
        let event = null;
        try {
          const client = getSupabase();
          if (client && dim > 0) {
            const { data, error } = await client
              .rpc("match_top_poly_event", { query_embedding: vector, match_threshold: 0.4, top_k: 3 });
            if (error) {
              console.warn("[worker] RPC error:", error.message);
            } else if (Array.isArray(data) && data.length) {
              // rows: [{ id, title, similarity }, ...]
              matches = data;
              // Fetch full event by top match id from Gamma API (avoids CORS in content script)
              const top = matches[0];
              if (top && (top.id !== undefined && top.id !== null)) {
                try {
                  const resp = await fetch(`${GAMMA_API}/events/${encodeURIComponent(top.id)}`, { headers: { "Accept": "application/json" } });
                  if (resp.ok) {
                    event = await resp.json();
                    if (event && typeof top.similarity === "number") event._similarity = top.similarity;
                  }
                } catch (e) {
                  // ignore fetch errors; fall back to matches-only
                }
              }
            }
          }
        } catch (e) {
          console.warn("[worker] RPC call failed", e);
        }

        sendResponse({ ok: true, id, embedMs, modelLoadMs: modelLoadMs ?? 0, dim, matches, event });
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true; // async response
  }
});
