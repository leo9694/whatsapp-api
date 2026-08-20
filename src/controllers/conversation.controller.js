const conversationService = require("../services/conversation.service");
const {
  idSchema,
  paginationSchema,
  conversationListSchema,
  conversationStatusSchema,
  createConversationSchema,
  assignmentSchema,
} = require("../validators/conversation.validator");
const { textMessageSchema, reactionMessageSchema } = require("../validators/message.validator");
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
    const { text, replyToMessageId, agent } = textMessageSchema.parse(req.body);
    return res.status(201).json(await conversationService.sendText(id, text, agent, { replyToMessageId }));
  } catch (error) { return next(error); }
}

async function sendReaction(req, res, next) {
  try {
    const id = idSchema.parse(req.params.id);
    const { messageId, emoji, agent } = reactionMessageSchema.parse(req.body);
    return res.status(201).json(await conversationService.sendReaction(id, messageId, emoji, agent));
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
    const { status, agent } = conversationStatusSchema.parse(req.body);
    return res.json(await conversationService.changeStatus(id, status, agent));
  } catch (error) { return next(error); }
}

async function remove(req, res, next) {
  try {
    return res.json(await conversationService.deleteConversation(idSchema.parse(req.params.id)));
  } catch (error) { return next(error); }
}

async function assignment(req, res, next) {
  try {
    const id = idSchema.parse(req.params.id);
    return res.json(await conversationService.changeAssignment(id, assignmentSchema.parse(req.body)));
  } catch (error) { return next(error); }
}

module.exports = { list, get, create, messages, sendMessage, sendReaction, read, changeStatus, assignment, remove };
