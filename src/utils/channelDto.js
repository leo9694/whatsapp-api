function toChannelDto(channel) {
  if (!channel) return null;
  return {
    id: channel.id,
    phoneNumberId: channel.phoneNumberId,
    displayPhoneNumber: channel.displayPhoneNumber,
    displayName: channel.displayName,
    isDefault: channel.isDefault === true,
    isActive: channel.isActive === true,
  };
}

module.exports = { toChannelDto };
