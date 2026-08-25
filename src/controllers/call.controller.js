const callService = require("../services/call.service");
const transferService = require("../services/callTransfer.service");
const { success } = require("../utils/apiResponse");
const { idSchema, agentSchema } = require("../validators/conversation.validator");
const {
  callIdSchema, answerActionSchema, agentActionSchema, permissionRequestSchema,
  initiateCallSchema, callListSchema,
  mediaJoinSchema, mediaReadySchema, transferIdSchema, transferRequestSchema,
} = require("../validators/call.validator");

function authenticatedInput(req, input) {
  return { ...input, agent: req.agent || input.agent };
}

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
  try { return success(res, await callService.preAccept(callIdSchema.parse(req.params.callId), authenticatedInput(req, answerActionSchema.parse(req.body)))); }
  catch (error) { return next(error); }
}

async function accept(req, res, next) {
  try { return success(res, await callService.accept(callIdSchema.parse(req.params.callId), authenticatedInput(req, answerActionSchema.parse(req.body)))); }
  catch (error) { return next(error); }
}

async function reject(req, res, next) {
  try { return success(res, await callService.reject(callIdSchema.parse(req.params.callId), authenticatedInput(req, agentActionSchema.parse(req.body)))); }
  catch (error) { return next(error); }
}

async function terminate(req, res, next) {
  try { return success(res, await callService.terminate(callIdSchema.parse(req.params.callId), authenticatedInput(req, agentActionSchema.parse(req.body)))); }
  catch (error) { return next(error); }
}

async function permission(req, res, next) {
  try {
    const agent = req.agent || agentSchema.parse({
      ...req.query,
      ...(req.query.director !== undefined ? { director: req.query.director === "true" } : {}),
    });
    return success(res, await callService.getPermission(idSchema.parse(req.params.id), agent));
  }
  catch (error) { return next(error); }
}

async function requestPermission(req, res, next) {
  try { return success(res, await callService.requestPermission(idSchema.parse(req.params.id), authenticatedInput(req, permissionRequestSchema.parse(req.body))), 201); }
  catch (error) { return next(error); }
}

async function initiate(req, res, next) {
  try { return success(res, await callService.initiate(idSchema.parse(req.params.id), authenticatedInput(req, initiateCallSchema.parse(req.body))), 201); }
  catch (error) { return next(error); }
}

async function joinMedia(req, res, next) {
  try {
    return success(res, await callService.joinMedia(
      callIdSchema.parse(req.params.callId), mediaJoinSchema.parse(req.body), req.agent,
    ), 201);
  } catch (error) { return next(error); }
}

async function mediaReady(req, res, next) {
  try {
    return success(res, await callService.mediaReady(
      callIdSchema.parse(req.params.callId), mediaReadySchema.parse(req.body), req.agent,
    ));
  } catch (error) { return next(error); }
}

async function createOutboundMedia(req, res, next) {
  try {
    return success(res, await callService.createOutboundMedia(
      idSchema.parse(req.params.id), mediaJoinSchema.omit({ transferId: true }).parse(req.body), req.agent,
    ), 201);
  } catch (error) { return next(error); }
}

async function agents(_req, res, next) {
  try { return res.json(await callService.listAgents()); }
  catch (error) { return next(error); }
}

async function requestTransfer(req, res, next) {
  try {
    const input = transferRequestSchema.parse(req.body);
    return success(res, await transferService.requestTransfer(
      callIdSchema.parse(req.params.callId), input.targetAgentId, req.agent,
    ), 201);
  } catch (error) { return next(error); }
}

function transferAction(method) {
  return async (req, res, next) => {
    try {
      return success(res, await transferService[method](
        callIdSchema.parse(req.params.callId), transferIdSchema.parse(req.params.transferId), req.agent,
      ));
    } catch (error) { return next(error); }
  };
}

module.exports = {
  list, listConversation, preAccept, accept, reject, terminate, permission, requestPermission, initiate,
  joinMedia, mediaReady, createOutboundMedia, agents, requestTransfer,
  acceptTransfer: transferAction("acceptTransfer"),
  rejectTransfer: transferAction("rejectTransfer"),
  cancelTransfer: transferAction("cancelTransfer"),
};
