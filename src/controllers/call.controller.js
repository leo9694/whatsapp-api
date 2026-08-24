const callService = require("../services/call.service");
const { success } = require("../utils/apiResponse");
const { idSchema, agentSchema } = require("../validators/conversation.validator");
const {
  callIdSchema, answerActionSchema, agentActionSchema, permissionRequestSchema,
  initiateCallSchema, callListSchema,
} = require("../validators/call.validator");

async function list(req, res, next) {
  try { return res.json(await callService.listCalls(callListSchema.parse(req.query))); }
  catch (error) { return next(error); }
}

async function listConversation(req, res, next) {
  try {
    const filters = callListSchema.parse({ ...req.query, conversationId: idSchema.parse(req.params.id) });
    return res.json(await callService.listCalls(filters));
  } catch (error) { return next(error); }
}

async function preAccept(req, res, next) {
  try { return success(res, await callService.preAccept(callIdSchema.parse(req.params.callId), answerActionSchema.parse(req.body))); }
  catch (error) { return next(error); }
}

async function accept(req, res, next) {
  try { return success(res, await callService.accept(callIdSchema.parse(req.params.callId), answerActionSchema.parse(req.body))); }
  catch (error) { return next(error); }
}

async function reject(req, res, next) {
  try { return success(res, await callService.reject(callIdSchema.parse(req.params.callId), agentActionSchema.parse(req.body))); }
  catch (error) { return next(error); }
}

async function terminate(req, res, next) {
  try { return success(res, await callService.terminate(callIdSchema.parse(req.params.callId), agentActionSchema.parse(req.body))); }
  catch (error) { return next(error); }
}

async function permission(req, res, next) {
  try {
    const agent = agentSchema.parse({
      ...req.query,
      ...(req.query.director !== undefined ? { director: req.query.director === "true" } : {}),
    });
    return success(res, await callService.getPermission(idSchema.parse(req.params.id), agent));
  }
  catch (error) { return next(error); }
}

async function requestPermission(req, res, next) {
  try { return success(res, await callService.requestPermission(idSchema.parse(req.params.id), permissionRequestSchema.parse(req.body)), 201); }
  catch (error) { return next(error); }
}

async function initiate(req, res, next) {
  try { return success(res, await callService.initiate(idSchema.parse(req.params.id), initiateCallSchema.parse(req.body)), 201); }
  catch (error) { return next(error); }
}

module.exports = { list, listConversation, preAccept, accept, reject, terminate, permission, requestPermission, initiate };
