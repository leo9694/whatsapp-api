const prisma = require("../database/prisma");
const AppError = require("../utils/AppError");
const callRepository = require("../repositories/call.repository");
const transferRepository = require("../repositories/callTransfer.repository");
const mediaGateway = require("./callMediaGateway.service");
const presence = require("./callPresence.service");
const socket = require("../sockets/socket");
const logger = require("../utils/logger");

const OPEN_STATUSES = ["PENDING", "ACCEPTED"];
let expirationTimer;

function appError(message, status, code) {
  const error = new AppError(message, status);
  error.publicCode = code;
  return error;
}

function timeoutSeconds() {
  const value = Number(process.env.CALL_TRANSFER_TIMEOUT_SECONDS || 30);
  return Number.isInteger(value) && value >= 10 && value <= 300 ? value : 30;
}

function transferDto(transfer) {
  return {
    transferId: transfer.id,
    callId: transfer.call.metaCallId,
    conversationId: transfer.call.conversationId,
    fromAgent: { id: transfer.fromAgentId, name: transfer.fromAgentName },
    toAgent: { id: transfer.toAgentId, name: transfer.toAgentName },
    contact: transfer.call.contact ? {
      id: transfer.call.contact.id,
      name: transfer.call.contact.name || transfer.call.contact.profileName || null,
      phone: transfer.call.contact.phone || transfer.call.contact.waId || null,
    } : null,
    status: transfer.status,
    requestedAt: transfer.requestedAt?.toISOString?.() || transfer.requestedAt,
    expiresAt: transfer.expiresAt?.toISOString?.() || transfer.expiresAt,
  };
}

function assertActor(transfer, actor, role) {
  const expected = role === "target" ? transfer.toAgentId : transfer.fromAgentId;
  if (String(actor?.id || "") !== String(expected)) {
    throw appError("O atendente não está autorizado para esta transferência.", 403, "TRANSFER_FORBIDDEN");
  }
}

async function requestTransfer(metaCallId, targetAgentId, actor, dependencies = {}) {
  const db = dependencies.db || prisma;
  const targetId = String(targetAgentId);
  const call = await callRepository.findByMetaCallId(metaCallId, db);
  if (!call) throw new AppError("Chamada não encontrada.", 404);
  if (call.status !== "ACTIVE") throw appError("Somente chamadas ativas podem ser transferidas.", 409, "CALL_NOT_ACTIVE");
  if (String(call.currentAgentId || "") !== String(actor.id)) {
    throw appError("Somente o atendente atual pode transferir a chamada.", 403, "TRANSFER_FORBIDDEN");
  }
  if (targetId === String(actor.id)) throw appError("Selecione outro atendente.", 400, "INVALID_TRANSFER_TARGET");
  const target = (dependencies.presence || presence).get(targetId);
  if (!target || !target.online) throw appError("O atendente selecionado está offline.", 409, "AGENT_OFFLINE");
  const activeTargetCall = await callRepository.findActiveByAgent(targetId, db);
  if (target.availability !== "AVAILABLE" || activeTargetCall) {
    throw appError("O atendente selecionado já está em uma chamada.", 409, "AGENT_BUSY");
  }
  const now = new Date();
  let transfer;
  try {
    transfer = await transferRepository.create({
      callId: call.id,
      fromAgentId: String(actor.id), fromAgentName: actor.name,
      toAgentId: target.id, toAgentName: target.name,
      requestedAt: now,
      expiresAt: new Date(now.getTime() + timeoutSeconds() * 1000),
    }, db);
  } catch (error) {
    if (error.code === "P2002") throw appError("Já existe uma transferência em andamento.", 409, "TRANSFER_ALREADY_PENDING");
    throw error;
  }
  const payload = transferDto(transfer);
  presence.markBusy(target.id, metaCallId);
  (dependencies.socket || socket).emitToAgent(target.id, "call:transfer:incoming", payload);
  return payload;
}

async function acceptTransfer(metaCallId, transferId, actor, dependencies = {}) {
  const db = dependencies.db || prisma;
  const transfer = await transferRepository.findById(transferId, db);
  if (!transfer || transfer.call.metaCallId !== metaCallId) throw new AppError("Transferência não encontrada.", 404);
  assertActor(transfer, actor, "target");
  if (transfer.call.status !== "ACTIVE" || String(transfer.call.currentAgentId) !== transfer.fromAgentId) {
    throw appError("A chamada não está mais disponível para transferência.", 409, "TRANSFER_STALE");
  }
  if (transfer.expiresAt <= new Date()) {
    await transferRepository.transition(transfer.id, OPEN_STATUSES, { status: "EXPIRED" }, db);
    throw appError("A solicitação de transferência expirou.", 409, "TRANSFER_EXPIRED");
  }
  const changed = await transferRepository.transition(transfer.id, ["PENDING"], {
    status: "ACCEPTED", acceptedAt: new Date(),
  }, db);
  if (changed.count !== 1) throw appError("A transferência já foi respondida.", 409, "TRANSFER_NOT_PENDING");
  const payload = { ...transferDto(transfer), status: "ACCEPTED" };
  const socketServer = dependencies.socket || socket;
  socketServer.joinAgentCall?.(transfer.toAgentId, metaCallId);
  socketServer.emitToAgents(
    [transfer.fromAgentId, transfer.toAgentId], "call:transfer:accepted", payload,
  );
  return payload;
}

async function rejectTransfer(metaCallId, transferId, actor, dependencies = {}) {
  const db = dependencies.db || prisma;
  const transfer = await transferRepository.findById(transferId, db);
  if (!transfer || transfer.call.metaCallId !== metaCallId) throw new AppError("Transferência não encontrada.", 404);
  assertActor(transfer, actor, "target");
  const changed = await transferRepository.transition(transfer.id, ["PENDING", "ACCEPTED"], {
    status: "REJECTED", rejectedAt: new Date(),
  }, db);
  if (changed.count !== 1) throw appError("A transferência já foi finalizada.", 409, "TRANSFER_CLOSED");
  await (dependencies.mediaGateway || mediaGateway).removeAgent(metaCallId, transfer.toAgentId).catch(() => {});
  presence.clearBusy(transfer.toAgentId, metaCallId);
  const payload = { ...transferDto(transfer), status: "REJECTED" };
  const socketServer = dependencies.socket || socket;
  socketServer.leaveAgentCall?.(transfer.toAgentId, metaCallId);
  socketServer.emitToAgents(
    [transfer.fromAgentId, transfer.toAgentId], "call:transfer:rejected", payload,
  );
  return payload;
}

async function cancelTransfer(metaCallId, transferId, actor, dependencies = {}) {
  const db = dependencies.db || prisma;
  const transfer = await transferRepository.findById(transferId, db);
  if (!transfer || transfer.call.metaCallId !== metaCallId) throw new AppError("Transferência não encontrada.", 404);
  assertActor(transfer, actor, "source");
  const changed = await transferRepository.transition(transfer.id, ["PENDING", "ACCEPTED"], {
    status: "CANCELLED", cancelledAt: new Date(),
  }, db);
  if (changed.count !== 1) throw appError("A transferência já foi finalizada.", 409, "TRANSFER_CLOSED");
  await (dependencies.mediaGateway || mediaGateway).removeAgent(metaCallId, transfer.toAgentId).catch(() => {});
  presence.clearBusy(transfer.toAgentId, metaCallId);
  const payload = { ...transferDto(transfer), status: "CANCELLED" };
  const socketServer = dependencies.socket || socket;
  socketServer.leaveAgentCall?.(transfer.toAgentId, metaCallId);
  socketServer.emitToAgents(
    [transfer.fromAgentId, transfer.toAgentId], "call:transfer:cancelled", payload,
  );
  return payload;
}

async function completeTransfer(metaCallId, transferId, actor, dependencies = {}) {
  const db = dependencies.db || prisma;
  const gateway = dependencies.mediaGateway || mediaGateway;
  const transfer = await transferRepository.findById(transferId, db);
  if (!transfer || transfer.call.metaCallId !== metaCallId) throw new AppError("Transferência não encontrada.", 404);
  assertActor(transfer, actor, "target");
  if (transfer.status !== "ACCEPTED" || transfer.expiresAt <= new Date()) {
    throw appError("A transferência não está aguardando mídia.", 409, "TRANSFER_NOT_ACCEPTED");
  }
  if (transfer.call.status !== "ACTIVE" || String(transfer.call.currentAgentId) !== transfer.fromAgentId) {
    throw appError("A chamada mudou durante a transferência.", 409, "TRANSFER_STALE");
  }
  const readiness = await gateway.agentReady(metaCallId, actor.id);
  if (!readiness.ready) throw appError("O áudio do novo atendente ainda não está pronto.", 409, "MEDIA_NOT_READY");
  const switched = await gateway.setCurrentAgent(metaCallId, actor.id);
  const now = new Date();
  try {
    await db.$transaction(async (tx) => {
      const changed = await transferRepository.transition(transfer.id, ["ACCEPTED"], {
        status: "COMPLETED", mediaReadyAt: now, completedAt: now,
      }, tx);
      if (changed.count !== 1) throw appError("A transferência foi concluída por outra sessão.", 409, "TRANSFER_RACE");
      await tx.call.update({
        where: { id: transfer.callId },
        data: { currentAgentId: String(actor.id), currentAgentName: actor.name },
      });
      if (transfer.call.conversationId) {
        await tx.conversation.update({
          where: { id: transfer.call.conversationId },
          data: { assignedUserId: String(actor.id), assignedUserName: actor.name, assignedAt: now },
        });
      }
    });
  } catch (error) {
    if (switched.previousAgentId) await gateway.setCurrentAgent(metaCallId, switched.previousAgentId).catch(() => {});
    throw error;
  }
  await gateway.removeAgent(metaCallId, transfer.fromAgentId).catch(() => {});
  presence.clearBusy(transfer.fromAgentId, metaCallId);
  presence.markBusy(transfer.toAgentId, metaCallId);
  const payload = { ...transferDto(transfer), status: "COMPLETED", completedAt: now.toISOString() };
  const socketServer = dependencies.socket || socket;
  socketServer.leaveAgentCall?.(transfer.fromAgentId, metaCallId);
  socketServer.emitToAgent(transfer.fromAgentId, "call:transferred:away", payload);
  socketServer.emitToAgent(transfer.toAgentId, "call:transfer:completed", payload);
  return payload;
}

async function expireDueTransfers(dependencies = {}) {
  const db = dependencies.db || prisma;
  const gateway = dependencies.mediaGateway || mediaGateway;
  const expired = await transferRepository.listExpired(new Date(), db);
  for (const transfer of expired) {
    const changed = await transferRepository.transition(transfer.id, OPEN_STATUSES, { status: "EXPIRED" }, db);
    if (changed.count !== 1) continue;
    await gateway.removeAgent(transfer.call.metaCallId, transfer.toAgentId).catch(() => {});
    presence.clearBusy(transfer.toAgentId, transfer.call.metaCallId);
    const payload = { ...transferDto(transfer), status: "EXPIRED" };
    const socketServer = dependencies.socket || socket;
    socketServer.leaveAgentCall?.(transfer.toAgentId, transfer.call.metaCallId);
    socketServer.emitToAgents(
      [transfer.fromAgentId, transfer.toAgentId], "call:transfer:expired", payload,
    );
  }
  return expired.length;
}

async function cancelForEndedCall(call, dependencies = {}) {
  const db = dependencies.db || prisma;
  const open = await transferRepository.listOpenByCallId(call.id, db);
  for (const transfer of open) {
    const changed = await transferRepository.transition(transfer.id, OPEN_STATUSES, {
      status: "CANCELLED", cancelledAt: new Date(),
    }, db);
    if (changed.count === 1) {
      presence.clearBusy(transfer.toAgentId, call.metaCallId);
      const payload = { ...transferDto({ ...transfer, call }), status: "CANCELLED", reason: "CALL_ENDED" };
      const socketServer = dependencies.socket || socket;
      socketServer.leaveAgentCall?.(transfer.toAgentId, call.metaCallId);
      socketServer.emitToAgents(
        [transfer.fromAgentId, transfer.toAgentId], "call:transfer:cancelled", payload,
      );
    }
  }
}

function startExpirationWorker() {
  if (expirationTimer) return;
  expirationTimer = setInterval(() => {
    expireDueTransfers().catch((error) => logger.error("call_transfer_expiration_failed", { message: error.message }));
  }, 5000);
  expirationTimer.unref();
}

function stopExpirationWorker() {
  clearInterval(expirationTimer);
  expirationTimer = null;
}

module.exports = {
  acceptTransfer, cancelForEndedCall, cancelTransfer, completeTransfer, expireDueTransfers,
  rejectTransfer, requestTransfer, startExpirationWorker, stopExpirationWorker, transferDto,
};
