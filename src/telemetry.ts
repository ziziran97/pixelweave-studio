/** Only operational metadata belongs here: never images, URLs, text, masks or credentials. */
export type EraseTelemetryEnvironment = "development" | "local-test" | "demo" | "test" | "production";
export type EraseTelemetryDetails = {
  serverRequestId?: string; algorithmVersion?: string; httpStatus?: number;
  queueWaitMs?: number; inferenceMs?: number; serverTotalMs?: number;
};
export type EraseExitReason = "user_cancel" | "user_discard" | "image_change" | "upload" | "close" | "stale" | "page_exit" | "unmount";
type EventData =
  | { name: "erase_started" | "erase_request_started" }
  | { name: "erase_request_finished"; outcome: "success" | "failure" | "cancelled"; durationMs: number; errorCode?: string }
  | { name: "erase_preparation_failed"; errorCode: string }
  | { name: "erase_preview_failed"; stage: "generate" | "load"; attempt: number }
  | { name: "erase_preview_shown"; durationMs: number }
  | { name: "erase_apply_failed" }
  | { name: "erase_cancelled"; stage: "preparing" | "waiting" | "preview"; reason: EraseExitReason }
  | { name: "erase_decision"; outcome: "accepted" | "discarded" | "no_decision"; previewShown: boolean; reason?: EraseExitReason };
export type EraseTelemetryEvent = EventData & EraseTelemetryDetails & {
  schemaVersion: 1; eventId: string; requestId: string; occurredAt: string;
  environment: EraseTelemetryEnvironment; documentId: string; imageSessionId: string; revision: number;
  width: number; height: number; source: "online" | "upload";
  taskId?: string; imageId?: string;
};
export type EraseTelemetryOptions = {
  environment?: EraseTelemetryEnvironment;
  onEvent: (event: EraseTelemetryEvent) => void | Promise<void>;
};
type RunContext = Pick<EraseTelemetryEvent, "requestId" | "documentId" | "imageSessionId" | "revision" | "width" | "height" | "source" | "taskId" | "imageId">;
const recent: EraseTelemetryEvent[] = [];
/** Development diagnostics only; bounded, memory-only and cleared on page reload. */
export function readEraseTelemetry() { return structuredClone(recent); }
export function clearEraseTelemetry() { recent.length = 0; }

export class EraseTelemetry {
  private sequence = 0;
  constructor(private environment: EraseTelemetryEnvironment, private receiver?: EraseTelemetryOptions["onEvent"], private debug = false) {}
  start(context: RunContext) {
    context = { ...context };
    return new EraseTelemetryRun({ ...context }, (data, details) => {
      const event: EraseTelemetryEvent = { ...context, ...details, ...data, schemaVersion: 1,
        environment: this.environment, occurredAt: new Date().toISOString(), eventId: `${context.requestId}:${++this.sequence}` };
      if (this.debug) { recent.push(structuredClone(event)); if (recent.length > 200) recent.shift(); }
      // Never await a receiver in an editing operation. Catch sync and async failures.
      if (this.receiver) queueMicrotask(() => {
        try { Promise.resolve(this.receiver!(structuredClone(event))).catch(() => {}); } catch { /* Diagnostics must not break editing. */ }
      });
    });
  }
}

export class EraseTelemetryRun {
  readonly requestId: string;
  private started = performance.now();
  private requested?: number;
  private requestDone = false;
  private hasResult = false;
  private ended = false;
  private shown = false;
  private failures = new Set<string>();
  private cancellations = new Set<string>();
  private details: EraseTelemetryDetails = {};
  constructor(context: RunContext, private write: (data: EventData, details: EraseTelemetryDetails) => void) {
    this.requestId = context.requestId; this.emit({ name: "erase_started" });
  }
  private emit(data: EventData) { if (!this.ended) this.write(data, this.details); }
  response(details: EraseTelemetryDetails) { if (!this.ended) this.details = { ...details }; }
  requestStarted() {
    if (this.ended || this.requested !== undefined) return;
    this.requested = performance.now(); this.emit({ name: "erase_request_started" });
  }
  requestFinished(outcome: "success" | "failure" | "cancelled", errorCode?: string) {
    if (this.ended || this.requestDone || this.requested === undefined) return;
    this.requestDone = true; this.hasResult = outcome === "success";
    this.emit({ name: "erase_request_finished", outcome, durationMs: Math.max(0, Math.round(performance.now() - this.requested)), ...(errorCode ? { errorCode } : {}) });
    if (outcome === "failure") this.ended = true;
  }
  preparationFailed() { this.emit({ name: "erase_preparation_failed", errorCode: "PREPARATION_FAILED" }); this.ended = true; }
  previewFailed(stage: "generate" | "load", attempt: number, key: string) {
    if (!this.hasResult || this.failures.has(key)) return;
    this.failures.add(key); this.emit({ name: "erase_preview_failed", stage, attempt });
  }
  previewShown() {
    if (!this.hasResult || this.shown || this.ended) return;
    this.shown = true; this.emit({ name: "erase_preview_shown", durationMs: Math.max(0, Math.round(performance.now() - this.started)) });
  }
  applyFailed() { this.emit({ name: "erase_apply_failed" }); }
  decision(outcome: "accepted" | "discarded" | "no_decision", reason?: EraseExitReason) {
    if (this.hasResult) this.emit({ name: "erase_decision", outcome, previewShown: this.shown, ...(reason ? { reason } : {}) });
    this.ended = true;
  }
  cancel(stage: "preparing" | "waiting" | "preview", reason: EraseExitReason, key: string) {
    if (this.cancellations.has(key) || this.ended) return;
    this.cancellations.add(key);
    this.requestFinished("cancelled");
    this.emit({ name: "erase_cancelled", stage, reason });
    if (!this.hasResult) this.ended = true;
  }
}

declare global {
  interface Window { pixelweaveTelemetry?: { read: typeof readEraseTelemetry; clear: typeof clearEraseTelemetry } }
}
