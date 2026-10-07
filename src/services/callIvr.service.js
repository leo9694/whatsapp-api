const AppError = require("../utils/AppError");
const logger = require("../utils/logger");
const { toCallDto } = require("../utils/callDto");

const terminal = new Set(["ENDED", "MISSED", "FAILED", "REJECTED", "BUSY"]);

function validateConfig(input) {
  if (!input || typeof input.enabled !== "boolean") throw new AppError("Configuração de URA inválida.", 400);
  if (!input.enabled) return { enabled: false };
  const options = {};
  for (const digit of ["1", "2", "3"]) {
    const option = input.options?.[digit];
    if (!option || typeof option.name !== "string" || !option.name.trim() || option.name.length > 80
      || !Array.isArray(option.agentIds) || option.agentIds.length > 500
      || option.agentIds.some((id) => !/^\d{1,16}$/.test(String(id)))) {
      throw new AppError("Configure Financeiro, Vendas e Compras para habilitar a URA.", 400);
    }
    options[digit] = { name: option.name.trim(), agentIds: [...new Set(option.agentIds.map(String))] };
  }
  return { enabled: true, options, sectorTimeoutMs: 25000, menuTimeoutMs: 45000, queueTimeoutMs: 120000 };
}

function createIvr(deps) {
  const sessions = new Map();
  const busy = new Set();
  const clock = deps.now || Date.now;
  const updateWaiting = deps.repo.updateUnclaimed || deps.repo.update;
  const publish = (call, event, ids) => deps.socket.emitToAgents(ids, event, toCallDto(call));
  const available = (call) => deps.presence.availableForChannel(call.channelId);
  function allowedIds(call) {
    const state = call.ivrState;
    if (!state || state.phase === "AGENT") return null;
    if (state.phase !== "QUEUE") return [];
    const all = available(call).filter((id) => !state.declined?.includes(id));
    const configured = sessions.get(call.metaCallId)?.config || call.channel?.callIvrConfig;
    return state.fallback ? all : all.filter((id) => configured?.options?.[state.option]?.agentIds.includes(id));
  }
  function guard(call, agent) {
    const ids = allowedIds(call);
    if (ids && !ids.includes(String(agent.id))) throw new AppError("Esta chamada ainda não foi direcionada para você.", 403);
  }
  function finish(callId) { sessions.delete(callId); }
  async function route(session, option, fallback = false) {
    const state = { ...session.call.ivrState, phase: "QUEUE", option, fallback, declined: [] };
    session.call = await deps.repo.update(session.call.metaCallId, { ivrState: state });
    session.routedAt = clock();
    await deps.gateway.playIvr(session.call.metaCallId, false, option ? "wait" : undefined);
    if (!allowedIds(session.call).length && !fallback) {
      session.call = await deps.repo.update(session.call.metaCallId, { ivrState: { ...state, fallback: true } });
    }
  }
  async function notify(session) {
    if (terminal.has(session.call.status) || session.call.currentAgentId) return;
    const ids = allowedIds(session.call).filter((id) => session.notified.get(id) !== deps.presence.connectionVersion(id));
    if (ids.length) {
      publish(session.call, "call:incoming", ids);
      ids.forEach((id) => session.notified.set(id, deps.presence.connectionVersion(id)));
    }
  }
  async function close(session, reason) {
    const call = session.call;
    await deps.whatsapp[call.ivrState?.accepted ? "terminateCall" : "rejectCall"](call.phoneNumberId, call.metaCallId).catch(() => {});
    await deps.gateway.closeCall(call.metaCallId).catch(() => {});
    const ended = await deps.repo.update(call.metaCallId, { status: "ENDED", endedAt: new Date(clock()), endReason: reason });
    finish(call.metaCallId);
    publish(ended, "call:ended", deps.presence.list().filter((a) => a.online).map((a) => a.id));
  }
  async function start(call, config) {
    if (sessions.has(call.metaCallId)) return;
    const session = { call, config, startedAt: clock(), menuAt: clock(), routedAt: 0, digitId: 0, notified: new Map() };
    sessions.set(call.metaCallId, session);
    busy.add(call.metaCallId);
    let preAccepted = false;
    let accepted = false;
    try {
      session.call = await deps.repo.update(call.metaCallId, { ivrState: { phase: "MENU", accepted: false } });
      const meta = await deps.gateway.getMetaSession(call.metaCallId);
      await deps.gateway.playIvr(call.metaCallId, false);
      await deps.whatsapp.preAcceptCall(call.phoneNumberId, call.metaCallId, meta.sdp);
      preAccepted = true;
      const ready = await deps.gateway.waitForMetaReady(call.metaCallId);
      if (!ready.ready) throw new AppError("O áudio da Meta não conectou para a URA.", 502);
      const latest = await deps.repo.findByMetaCallId(call.metaCallId);
      if (!latest || terminal.has(latest.status)) { finish(call.metaCallId); return; }
      await deps.whatsapp.acceptCall(call.phoneNumberId, call.metaCallId, meta.sdp);
      accepted = true;
      session.call = await updateWaiting(call.metaCallId, {
        status: "ACTIVE", answeredAt: new Date(clock()), ivrState: { phase: "MENU", accepted: true },
      });
      if (!session.call || terminal.has(session.call.status)) { finish(call.metaCallId); return; }
      session.startedAt = clock();
      session.menuAt = clock();
      await deps.gateway.playIvr(call.metaCallId, true);
    } catch (error) {
      const latest = await deps.repo.findByMetaCallId(call.metaCallId);
      if (latest && !terminal.has(latest.status)) {
        if (preAccepted) await deps.whatsapp[accepted ? "terminateCall" : "rejectCall"](call.phoneNumberId, call.metaCallId).catch(() => {});
        await deps.gateway.closeCall(call.metaCallId).catch(() => {});
        const failed = await deps.repo.update(call.metaCallId, { status: "FAILED", endedAt: new Date(clock()), endReason: "IVR_MEDIA_FAILED" });
        publish(failed, "call:failed", deps.presence.list().filter((a) => a.online).map((a) => a.id));
      }
      finish(call.metaCallId);
      logger.error("call_ivr_start_failed", { callId: call.metaCallId, message: error.message });
    } finally { busy.delete(call.metaCallId); }
  }
  async function tick(callId) {
    const session = sessions.get(callId);
    if (!session || busy.has(callId)) return;
    busy.add(callId);
    try {
      const latest = await deps.repo.findByMetaCallId(callId);
      if (!latest || terminal.has(latest.status) || latest.currentAgentId) { finish(callId); return; }
      if (deps.claimed?.(callId)) return;
      session.call = latest;
      if (clock() - session.startedAt >= session.config.queueTimeoutMs) { await close(session, "IVR_QUEUE_TIMEOUT"); return; }
      if (latest.ivrState?.phase === "MENU") {
        const snapshot = await deps.gateway.getIvr(callId);
        for (const event of snapshot.digits || []) {
          if (event.id <= session.digitId) continue;
          session.digitId = event.id;
          if (session.config.options[event.digit]) { await route(session, event.digit); break; }
          if (event.digit === "9") {
            await deps.gateway.playIvr(callId, true);
            session.menuAt = clock();
          }
        }
        if (session.call.ivrState.phase === "MENU" && clock() - session.menuAt >= session.config.menuTimeoutMs) await route(session, null, true);
      }
      if (session.call.ivrState?.phase === "QUEUE") {
        if (!session.call.ivrState.fallback && (clock() - session.routedAt >= session.config.sectorTimeoutMs || !allowedIds(session.call).length)) {
          session.call = await deps.repo.update(callId, { ivrState: { ...session.call.ivrState, fallback: true } });
        }
        await notify(session);
      }
    } catch (error) {
      logger.error("call_ivr_tick_failed", { callId, message: error.message });
    } finally { busy.delete(callId); }
  }
  async function decline(call, agent) {
    guard(call, agent);
    const updated = await deps.repo.update(call.metaCallId, { ivrState: {
      ...call.ivrState, declined: [...new Set([...(call.ivrState.declined || []), String(agent.id)])],
    } });
    return toCallDto(updated);
  }
  async function recover(calls) {
    for (const call of calls) {
      const config = call.channel?.callIvrConfig;
      if (!config?.enabled || !call.ivrState || call.ivrState.phase === "AGENT") continue;
      const session = { call, config, startedAt: clock(), routedAt: clock(), digitId: 0, notified: new Map() };
      sessions.set(call.metaCallId, session);
      try {
        if (!call.ivrState.accepted) await close(session, "IVR_RESTART_BEFORE_ACCEPT");
        else await route(session, null, true);
      }
      catch { await close(session, "IVR_RESTART_MEDIA_UNAVAILABLE"); }
    }
  }
  return { start, tick, guard, finish, decline, recover, ids: () => [...sessions.keys()] };
}

const prisma = require("../database/prisma");
const repo = require("../repositories/call.repository");
const ivr = createIvr({
  repo, gateway: require("./callMediaGateway.service"), whatsapp: require("./whatsapp.service"),
  presence: require("./callPresence.service"), socket: require("../sockets/socket"),
  claimed: require("./callSessionStore").get,
});
let worker;
async function configure(channelId, input, agent, db = prisma, gateway = require("./callMediaGateway.service")) {
  if (!agent?.director || agent.environment !== "production") throw new AppError("Somente a diretoria em produção pode configurar a URA.", 403);
  const config = validateConfig(input);
  if (config.enabled) {
    if (!gateway.enabled()) throw new AppError("Habilite o gateway de mídia antes de ativar a URA.", 409);
    await gateway.ivrCapabilities();
  }
  const channel = await db.whatsAppChannel.findUnique({ where: { id: channelId } });
  if (!channel?.isActive) throw new AppError("Número de atendimento indisponível.", 404);
  await db.whatsAppChannel.update({ where: { id: channelId }, data: { callIvrConfig: config } });
  return config;
}
function startWorker() {
  if (worker) return;
  worker = setInterval(() => ivr.ids().forEach((id) => ivr.tick(id)), 500);
  worker.unref();
  prisma.call.findMany({ where: { status: { in: ["RINGING", "CONNECTING", "ACTIVE"] }, currentAgentId: null }, include: { channel: true, contact: true } })
    .then((calls) => ivr.recover(calls)).catch((e) => logger.error("call_ivr_recovery_failed", { message: e.message }));
}
function stopWorker() { clearInterval(worker); worker = null; }
module.exports = { ...ivr, configure, validateConfig, createIvr, startWorker, stopWorker };
