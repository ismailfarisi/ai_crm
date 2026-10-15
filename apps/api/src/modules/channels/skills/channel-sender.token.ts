/**
 * Alias for ChannelsService, so the skill registry can look it up without
 * importing channels.service. That import closed a load-time cycle
 * (channels.service → channel-command.service → skill.registry →
 * channels.service) that left SkillRegistry undefined in Nest's metadata.
 */
export const CHANNEL_SENDER = Symbol('CHANNEL_SENDER');
