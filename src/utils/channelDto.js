function toChannelDto(channel) {
  if (!channel) return null;
  return {
    id: channel.id,
    phoneNumberId: channel.phoneNumberId,
    displayPhoneNumber: channel.displayPhoneNumber,
    displayName: channel.displayName,
    profilePictureUrl: channel.profilePictureUrl || null,
    isDefault: channel.isDefault === true,
    isActive: channel.isActive === true,
  };
}

module.exports = { toChannelDto };
