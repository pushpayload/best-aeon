import { userMention, Message, ThreadAutoArchiveDuration } from 'discord.js'
// @ts-ignore
import sellChannels from '../constants/sellChannels.js'
import { isSellMessage } from '../features/sell-schedule.ts'
import { Logger } from '../helpers/logger.ts'
import { ScheduleMessageParser } from '../helpers/scheduleMessageParser.ts'

export default async function (messageText: string, message: Message<boolean>) {
  const logger: Logger = new Logger({ functionName: 'startSellThread' })

  if (sellChannels[message.channelId]) {
    if (isSellMessage(message)) {
      if (!message.hasThread) {
        const threadTitle = ScheduleMessageParser.getTitleFromMessage(message)
          ? ScheduleMessageParser.getTitleFromMessage(message)
          : 'Please put the thread title on first line of sell post'
        const thread = await message
          .startThread({ name: threadTitle, autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek })
          .catch((error) => {
            logger.error('Failed to start thread', error)
            return false
          })
        if (thread) {
          logger.info(`Thread created for message ${threadTitle}}`)
          return true
        }
      }
    }
    return true
  }
}
