const templateService = require("../services/template.service");
const conversationService = require("../services/conversation.service");
const { idSchema } = require("../validators/conversation.validator");
const {
  templateListSchema, templateNameSchema, languageSchema, previewSchema, sendTemplateSchema,
} = require("../validators/template.validator");
const { success } = require("../utils/apiResponse");

async function list(req, res, next) {
  try { return success(res, await templateService.listTemplates(templateListSchema.parse(req.query))); }
  catch (error) { return next(error); }
}

async function get(req, res, next) {
  try {
    const name = templateNameSchema.parse(req.params.name);
    const language = req.query.language ? languageSchema.parse(req.query.language) : undefined;
    return success(res, await templateService.findTemplate(name, language));
  } catch (error) { return next(error); }
}

async function preview(req, res, next) {
  try { return success(res, await templateService.previewTemplate(previewSchema.parse(req.body))); }
  catch (error) { return next(error); }
}

async function send(req, res, next) {
  try {
    const input = sendTemplateSchema.parse(req.body);
    const data = await conversationService.sendTemplate(idSchema.parse(req.params.id), input, input.agent);
    return success(res, data, 201);
  } catch (error) { return next(error); }
}

module.exports = { list, get, preview, send };
