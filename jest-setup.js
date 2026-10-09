// Jest setup provided by Grafana scaffolding
import './.config/jest-setup';

// React 19's react-dom/server.browser, which @grafana/ui 13 imports, creates a
// MessageChannel when loaded, and jsdom has none. Node's own would keep jest
// from exiting (an open port holds the event loop), so a timer-backed stub.
if (typeof globalThis.MessageChannel === 'undefined') {
  class MessageChannelStub {
    constructor() {
      this.port1 = { onmessage: null, postMessage() {}, close() {} };
      this.port2 = {
        postMessage: (data) => setTimeout(() => this.port1.onmessage?.({ data }), 0),
        close() {},
      };
    }
  }
  globalThis.MessageChannel = MessageChannelStub;
}
