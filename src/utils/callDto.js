function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toCallDto(call) {
  if (!call) return call;
  return {
    id: call.id,
    callId: call.metaCallId,
    conversationId: call.conversationId || null,
    contactId: call.contactId || null,
    phoneNumberId: call.phoneNumberId,
    direction: call.direction,
    status: call.status,
    remotePhone: call.remotePhone || null,
    startedAt: iso(call.startedAt),
    answeredAt: iso(call.answeredAt),
    endedAt: iso(call.endedAt),
    durationSeconds: call.durationSeconds ?? null,
    endReason: call.endReason || null,
    createdAt: iso(call.createdAt),
    updatedAt: iso(call.updatedAt),
    ...(call.contact ? {
      contact: {
        id: call.contact.id,
        name: call.contact.name || call.contact.profileName || null,
        phone: call.contact.phone || call.contact.waId || null,
      },
    } : {}),
  };
}

module.exports = { toCallDto };
