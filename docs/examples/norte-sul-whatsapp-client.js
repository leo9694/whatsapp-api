class NorteSulWhatsAppApiError extends Error {
  constructor(message, { status, code, details, responseBody } = {}) {
    super(message);
    this.name = "NorteSulWhatsAppApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.responseBody = responseBody;
  }
}

class NorteSulWhatsAppClient {
  constructor({ baseUrl, apiKey, fetchImpl = globalThis.fetch } = {}) {
    if (!baseUrl) throw new TypeError("baseUrl é obrigatório.");
    if (!apiKey) throw new TypeError("apiKey é obrigatória.");
    if (typeof fetchImpl !== "function") throw new TypeError("Este runtime não possui fetch.");
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async request(path, { method = "GET", body, headers = {}, raw = false } = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { "X-API-Key": this.apiKey, ...headers },
      body,
    });
    if (raw && response.ok) return response;

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const apiError = payload?.error || {};
      throw new NorteSulWhatsAppApiError(
        apiError.message || `A API respondeu HTTP ${response.status}.`,
        {
          status: response.status,
          code: apiError.code,
          details: apiError.details,
          responseBody: payload,
        },
      );
    }
    return payload?.success === true && Object.hasOwn(payload, "data") ? payload.data : payload;
  }

  json(path, method, value) {
    return this.request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
  }

  status() {
    return this.request("/api/status");
  }

  createConversation({ name, phone }) {
    return this.json("/api/conversations", "POST", { name, phone });
  }

  listConversations({ page = 1, limit = 30, search, status } = {}) {
    const query = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) query.set("search", search);
    if (status) query.set("status", status);
    return this.request(`/api/conversations?${query}`);
  }

  getConversation(conversationId) {
    return this.request(`/api/conversations/${encodeURIComponent(conversationId)}`);
  }

  listMessages(conversationId, { page = 1, limit = 30 } = {}) {
    const query = new URLSearchParams({ page: String(page), limit: String(limit) });
    return this.request(`/api/conversations/${encodeURIComponent(conversationId)}/messages?${query}`);
  }

  sendText(conversationId, text) {
    return this.json(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, "POST", { text });
  }

  markRead(conversationId) {
    return this.request(`/api/conversations/${encodeURIComponent(conversationId)}/read`, { method: "POST" });
  }

  changeConversationStatus(conversationId, status) {
    return this.json(`/api/conversations/${encodeURIComponent(conversationId)}/status`, "PATCH", { status });
  }

  listTemplates({ status, language, category, search, refresh, page = 1, limit = 30 } = {}) {
    const query = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (status) query.set("status", status);
    if (language) query.set("language", language);
    if (category) query.set("category", category);
    if (search) query.set("search", search);
    if (refresh) query.set("refresh", "true");
    return this.request(`/api/templates?${query}`);
  }

  getTemplate(name, { language } = {}) {
    const query = new URLSearchParams();
    if (language) query.set("language", language);
    const suffix = query.size ? `?${query}` : "";
    return this.request(`/api/templates/${encodeURIComponent(name)}${suffix}`);
  }

  previewTemplate({ name, language, parameters = {} }) {
    return this.json("/api/templates/preview", "POST", { name, language, parameters });
  }

  sendTemplate(conversationId, { templateName, language, components = [] }) {
    return this.json(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages/template`,
      "POST",
      { templateName, language, components },
    );
  }

  sendMedia(conversationId, kind, file, { filename, caption, voice } = {}) {
    if (!(file instanceof Blob)) throw new TypeError("file deve ser Blob ou File.");
    const form = new FormData();
    form.append("file", file, filename || file.name || `upload-${Date.now()}`);
    if (caption !== undefined) form.append("caption", caption);
    if (filename !== undefined && kind === "document") form.append("filename", filename);
    if (voice !== undefined && kind === "audio") form.append("voice", String(Boolean(voice)));
    return this.request(
      `/api/conversations/${encodeURIComponent(conversationId)}/messages/${kind}`,
      { method: "POST", body: form },
    );
  }

  sendImage(conversationId, file, options) {
    return this.sendMedia(conversationId, "image", file, options);
  }

  sendDocument(conversationId, file, options) {
    return this.sendMedia(conversationId, "document", file, options);
  }

  sendVideo(conversationId, file, options) {
    return this.sendMedia(conversationId, "video", file, options);
  }

  sendAudio(conversationId, file, options) {
    return this.sendMedia(conversationId, "audio", file, options);
  }

  async getMediaBlob(mediaPathOrId) {
    const path = String(mediaPathOrId).startsWith("/api/media/")
      ? String(mediaPathOrId)
      : `/api/media/${encodeURIComponent(mediaPathOrId)}`;
    const response = await this.request(path, { raw: true });
    return response.blob();
  }
}

module.exports = { NorteSulWhatsAppClient, NorteSulWhatsAppApiError };
