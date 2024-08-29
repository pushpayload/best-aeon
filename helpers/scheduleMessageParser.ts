import { CalendarEvent } from 'calendar-link'
import { Client, Message } from 'discord.js'
import { MCMysticCoinEmoji } from '../constants/emojis.ts'
import sellChannels from '../constants/sellChannels.ts'
import { Logger, LogLevel } from './logger.ts'
import { DiscordTimeStampRegex } from '../constants/discordTimeStampRegex.ts'

export type ScheduleMessage = {
  id: string
  channelId: string
  reactorIds: string[]
  reactorNames: string[]
  region: string
  date: number
  text: string
  url: string
  calendarEvent?: CalendarEvent
}
export class ScheduleMessageParser {
  constructor() {}

  logger: Logger = new Logger({ functionName: 'ScheduleMessageParser', logLevel: LogLevel.debug })

  async parseScheduleMessage(message: Message<boolean>, client: Client): Promise<ScheduleMessage> {
    // if you don't import the regex from constants like this it will not work in some cases
    const matches = new RegExp(DiscordTimeStampRegex).exec(message.content)
    const groups = matches?.groups
    const timestamp: number = parseInt(matches?.groups?.timestamp ?? '0')
    const titleLimit = 100
    const titleText: string = ScheduleMessageParser.cleanUpTitle(
      (matches?.groups?.before?.toString().trim() ?? '') + ' ' + (matches?.groups?.after?.toString().trim() ?? ''),
      titleLimit,
    )

    let userIds: string[] = []

    let messageReaction = message.reactions.cache.get(MCMysticCoinEmoji)

    if (messageReaction) {
      if (messageReaction.partial) {
        messageReaction = await messageReaction.fetch()
      }

      const users = await messageReaction.users.fetch()
      userIds = users.map((_, id) => {
        return id
      })
    }

    const scheduleMessage: ScheduleMessage = {
      id: message.id,
      channelId: message.channelId,
      reactorIds: userIds,
      reactorNames: userIds.map((id) => {
        return client.users.cache.get(id)?.username ?? 'Unknown'
      }),
      region: sellChannels[message.channelId].region,
      date: timestamp,
      text: titleText,
      url: message.url,
    }
    scheduleMessage.calendarEvent = ScheduleMessageParser.createCalendarEventFromMessage(scheduleMessage)

    this.logger.debug('Adding to schedule: ', message.content)
    this.logger.debug('Matches: ', JSON.stringify(matches))
    this.logger.debug('Groups: ', JSON.stringify(groups))
    this.logger.debug('Time text: ', titleText)
    this.logger.debug('Timestamp: ', timestamp)
    this.logger.debug('ScheduleMessage: ', scheduleMessage)

    return scheduleMessage
  }

  static cleanUpTitle(title: string, titleLimit: number): string {
    title = title.replaceAll('@everyone', '').replaceAll('@', '').replaceAll('  ', ' ').trim()
    if (title.length > titleLimit) {
      title = title.slice(0, titleLimit - 3) + '...'
    }
    return title
  }

  static getTitleFromMessage(message: Message): string {
    const matches = new RegExp(DiscordTimeStampRegex).exec(message.content)
    const titleLimit = 100
    return ScheduleMessageParser.cleanUpTitle(
      (matches?.groups?.before?.toString().trim() ?? '') + ' ' + (matches?.groups?.after?.toString().trim() ?? ''),
      titleLimit,
    )
  }

  static createCalendarEventFromMessage(message: ScheduleMessage): CalendarEvent {
    // Convert timestamp to date, discord timestamps are in seconds so we multiply by 1000
    const date = new Date(message.date * 1000)

    // Default duration is 30 minutes
    const duration = 30

    return {
      title: message.text,
      description: `<h3><a href="${message.url}">${message.text}</a></h3>\n<b>Signups:</b> ${message.reactorNames.join(', ')}\n\n<b>Region:</b> ${message.region}\n\n<i>Calendar event generated at ${new Date().toTimeString()}</i>`,
      start: date,
      end: new Date(date.getTime() + duration * 60000),
      duration: [duration, 'minutes'],
      location: message.region,
      url: message.url,
      guests: message.reactorNames,
    }
  }
}
