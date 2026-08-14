const conversationService = require("../services/conversation.service");
const {
  idSchema,
  paginationSchema,
  conversationListSchema,
  conversationStatusSchema,
  createConversationSchema,
} = require("../validators/conversation.validator");
const { textMessageSchema } = require("../validators/message.validator");
const { success } = require("../utils/apiResponse");

async function list(req, res, next) {
  try {
    return res.json(await conversationService.listConversations(conversationListSchema.parse(req.query)));
  } catch (error) { return next(error); }
}

async function get(req, res, next) {
  try {
    return res.json(await conversationService.getConversation(idSchema.parse(req.params.id)));
  } catch (error) { return next(error); }
}

async function create(req, res, next) {
  try {
    const data = await conversationService.createConversation(createConversationSchema.parse(req.body));
    return success(res, data, data.created ? 201 : 200);
  } catch (error) { return next(error); }
}

async function messages(req, res, next) {
  try {
    return res.json(await conversationService.listMessages(
      idSchema.parse(req.params.id),
      paginationSchema.parse(req.query),
    ));
  } catch (error) { return next(error); }
}

async function sendMessage(req, res, next) {
  try {
    const id = idSchema.parse(req.params.id);
    const { text } = textMessageSchema.parse(req.body);
    return res.status(201).json(await conversationService.sendText(id, text));
  } catch (error) { return next(error); }
}

async function read(req, res, next) {
  try {
    return res.json(await conversationService.markRead(idSchema.parse(req.params.id)));
  } catch (error) { return next(error); }
}

async function changeStatus(req, res, next) {
  try {
    const id = idSchema.parse(req.params.id);
    const { status } = conversationStatusSchema.parse(req.body);
    return res.json(await conversationService.changeStatus(id, status));
  } catch (error) { return next(error); }
}

module.exports = { list, get, create, messages, sendMessage, read, changeStatus };
