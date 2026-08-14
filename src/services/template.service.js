const AppError = require("../utils/AppError");
const whatsappService = require("./whatsapp.service");

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache = { expiresAt: 0, templates: [] };

function placeholders(text = "") {
  return [...new Set([...text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
}

function componentExamples(component) {
  const example = component?.example || {};
  return {
    header: example.header_text || example.header_handle || [],
    body: example.body_text?.[0] || [],
  };
}

function normalizeTemplate(raw) {
  const components = Array.isArray(raw.components) ? raw.components : [];
  const find = (type) => components.find((item) => item.type === type);
  const header = find("HEADER");
  const body = find("BODY");
  const footer = find("FOOTER");
  const buttons = find("BUTTONS")?.buttons || [];
  return {
    id: raw.id || null,
    name: raw.name,
    language: raw.language,
    status: raw.status,
    category: raw.category || null,
    parameterFormat: raw.parameter_format || "POSITIONAL",
    header: header ? {
      format: header.format || "TEXT",
      text: header.text || null,
      placeholders: placeholders(header.text),
      examples: componentExamples(header).header,
    } : null,
    body: body ? {
      text: body.text || "",
      placeholders: placeholders(body.text),
      examples: componentExamples(body).body,
    } : null,
    footer: footer?.text || null,
    buttons: buttons.map((button, index) => ({
      index,
      type: button.type || null,
      text: button.text || null,
      url: button.url || null,
      phoneNumber: button.phone_number || null,
      example: button.example || null,
    })),
    qualityScore: raw.quality_score || null,
    rejectedReason: raw.rejected_reason || null,
    previousCategory: raw.previous_category || null,
  };
}

function sanitizeRaw(raw) {
  const allowed = ["id", "name", "language", "status", "category", "parameter_format", "components", "quality_score", "rejected_reason", "previous_category"];
  return Object.fromEntries(allowed.filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
}

async function getAllTemplates({ refresh = false, listMessageTemplates = whatsappService.listMessageTemplates } = {}) {
  if (!refresh && cache.expiresAt > Date.now()) return cache.templates;
  const templates = await listMessageTemplates();
  cache = { templates, expiresAt: Date.now() + CACHE_TTL_MS };
  return templates;
}

async function listTemplates(options = {}, dependencies = {}) {
  let templates = await getAllTemplates({ refresh: options.refresh, ...dependencies });
  if (options.status) templates = templates.filter((item) => item.status === options.status);
  if (options.language) templates = templates.filter((item) => item.language === options.language);
  if (options.category) templates = templates.filter((item) => item.category === options.category);
  if (options.search) {
    const search = options.search.toLowerCase();
    templates = templates.filter((item) => item.name?.toLowerCase().includes(search));
  }
  const total = templates.length;
  const start = (options.page - 1) * options.limit;
  return {
    data: templates.slice(start, start + options.limit).map((raw) => ({ template: normalizeTemplate(raw), raw: sanitizeRaw(raw) })),
    pagination: { page: options.page, limit: options.limit, total, totalPages: Math.ceil(total / options.limit) },
  };
}

async function findTemplate(name, language, dependencies = {}) {
  const templates = await getAllTemplates(dependencies);
  const matches = templates.filter((item) => item.name === name && (!language || item.language === language));
  if (!matches.length) throw new AppError("Template não encontrado.", 404);
  if (!language && matches.length > 1) throw new AppError("Informe o idioma do template.", 400);
  const raw = matches[0];
  return { template: normalizeTemplate(raw), raw: sanitizeRaw(raw) };
}

function applyValues(text, values = []) {
  return (text || "").replace(/\{\{(\d+)\}\}/g, (match, index) => values[Number(index) - 1] ?? match);
}

function parameterValue(parameter) {
  if (parameter?.text !== undefined) return String(parameter.text);
  if (parameter?.currency?.fallback_value !== undefined) return String(parameter.currency.fallback_value);
  if (parameter?.date_time?.fallback_value !== undefined) return String(parameter.date_time.fallback_value);
  return undefined;
}

function parametersFromComponents(components = []) {
  const result = { header: [], body: [], buttons: {} };
  for (const component of Array.isArray(components) ? components : []) {
    const type = String(component?.type || "").toLowerCase();
    const values = (component?.parameters || []).map(parameterValue);
    if (type === "header" || type === "body") result[type] = values;
    if (type === "button") result.buttons[String(component.index ?? "0")] = values;
  }
  return result;
}

function renderTemplate(template, components = []) {
  const parameters = parametersFromComponents(components);
  const buttons = (template.buttons || []).map((button) => ({
    ...button,
    url: button.url ? applyValues(button.url, parameters.buttons[String(button.index)] || []) : null,
  }));
  return {
    name: template.name,
    language: template.language,
    category: template.category || null,
    header: template.header?.text ? applyValues(template.header.text, parameters.header) : null,
    headerFormat: template.header?.format || null,
    body: applyValues(template.body?.text, parameters.body),
    footer: template.footer || null,
    buttons,
    components,
  };
}

async function previewTemplate({ name, language, parameters = {} }, dependencies = {}) {
  const found = await findTemplate(name, language, dependencies);
  const { template } = found;
  const missing = [];
  for (const section of ["header", "body"]) {
    for (const index of template[section]?.placeholders || []) {
      if (parameters[section]?.[index - 1] === undefined) missing.push({ section, index });
    }
  }
  return {
    name: template.name,
    language: template.language,
    header: template.header ? applyValues(template.header.text, parameters.header) : null,
    headerFormat: template.header?.format || null,
    body: applyValues(template.body?.text, parameters.body),
    footer: template.footer,
    buttons: template.buttons,
    missingParameters: missing,
    valid: missing.length === 0,
  };
}

function clearTemplateCache() {
  cache = { expiresAt: 0, templates: [] };
}

module.exports = {
  normalizeTemplate, listTemplates, findTemplate, previewTemplate, clearTemplateCache, placeholders,
  parametersFromComponents, renderTemplate,
};
