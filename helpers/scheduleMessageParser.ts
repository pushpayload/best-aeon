import { CalendarEvent } from 'calendar-link'
import { Client, Message } from 'discord.js'
import { MCMysticCoinEmoji } from '../constants/emojis.ts'
import sellChannels from '../constants/sellChannels.ts'
import { Logger, LogLevel } from './logger.ts'

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

  logger: Logger = new Logger({ functionName: 'ScheduleMessageParser' })

  async parseScheduleMessage(message: Message<boolean>, client: Client): Promise<ScheduleMessage> {
    const regex = /(?<before>.*)<t:(?<timestamp>\d+):[dDtTfFR]>(?<after>.*)/gm
    const matches = regex.exec(message.content)
    const groups = matches?.groups
    const timestamp: number = parseInt(matches?.groups?.timestamp ?? '0')
    const timeText: string =
      (matches?.groups?.before?.toString().trim() ?? '') + ' ' + (matches?.groups?.after?.toString().trim() ?? '')

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
      text: timeText.replaceAll('@everyone', '').replaceAll('@', '').replaceAll('  ', ' ').trim(),
      url: message.url,
    }
    scheduleMessage.calendarEvent = this.createCalendarEventFromMessage(scheduleMessage)

    this.logger.debug('Adding to schedule: ', message.content)
    this.logger.debug('Matches: ', JSON.stringify(matches))
    this.logger.debug('Groups: ', JSON.stringify(groups))
    this.logger.debug('Time text: ', timeText)
    this.logger.debug('Timestamp: ', timestamp)
    this.logger.debug('ScheduleMessage: ', scheduleMessage)

    return scheduleMessage
  }

  createCalendarEventFromMessage(message: ScheduleMessage): CalendarEvent {
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
