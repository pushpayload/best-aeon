import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Message,
  TextChannel,
} from 'discord.js'
import { CalendarEvent, google, ics } from 'calendar-link'
import sellChannels from '../constants/sellChannels.ts'
import Queue from 'queue'
import { Logger, LogLevel } from '../helpers/logger.ts'
import { ScheduleMessageParser } from '../helpers/scheduleMessageParser.ts'
import { MCMysticCoinEmoji, GCalEmoji } from '../constants/emojis.ts'
import GcalIntegration from './gcal-integration.ts'
import { DiscordTimeStampRegex } from '../constants/discordTimeStampRegex.ts'
import StartSellThread from '../onMessageCreateHooks/1.startSellThread.ts'

const logger: Logger = new Logger({ functionName: 'sell-schedule' })
const scheduleMessageParser: ScheduleMessageParser = new ScheduleMessageParser()

export default function (
  client: Client,
  scheduleChannelIds: { id: string; regions: string[] }[],
  gcal: GcalIntegration,
) {
  const q = new Queue({ autostart: true, concurrency: 1 })
  const schedule: ScheduleMessage[] = []
  let writtenSchedule: string[] = []
  let isStarting = true

  client.once('ready', async () => {
    try {
      for (let i = 0; i < scheduleChannelIds.length; i++) {
        const channelInfo = scheduleChannelIds[i]

        const channel = await client.channels.fetch(channelInfo.id)

        if (channel && channel instanceof TextChannel) {
          let message = await channel.messages
            .fetch()
            .then((messages) => messages.filter((message) => message.author.id === client.user?.id))
            .then((messages) => messages.at(0))

          if (!message) {
            await channel.send('Loading History...')
          }
        }
      }

      for (const sellChannelId in sellChannels) {
        logger.debug(`sellChannelId: ${sellChannelId}, region: ${sellChannels[sellChannelId].region}`)
        try {
          const sellChannel = await client.channels.fetch(sellChannelId)

          if (sellChannel && sellChannel instanceof TextChannel) {
            let sellMessages = await sellChannel.messages
              .fetch()
              .then((messages) => messages.filter((message) => isSellMessage(message)))

            if (sellMessages) {
              for (const sellMessage of sellMessages.values()) {
                if (sellMessage.partial) {
                  await sellMessage.fetch()
                }
                if (!sellMessage.hasThread) {
                  StartSellThread(sellMessage.content, sellMessage)
                }
                if (gcal.clientIsValid())
                  await updateSchedule(sellMessage).catch((e) =>
                    logger.error(`Error while trying to add to schedule: ${e}`),
                  )
              }
            }
          }
        } catch (e: any) {
          continue
        }
      }

      logger.log('loaded schedule', schedule.length)

      const endListener = () => {
        isStarting = false

        q.removeEventListener('end', endListener)
      }

      q.addEventListener('end', endListener)

      q.push(createMessages)
    } catch (e: any) {
      logger.error('---- AN ERROR WAS THROWN ----')
      logger.error('message', e.rawError?.message)
      logger.error('content', e.requestBody?.json?.content)
      logger.error('---- END ERROR ----')

      if (e.rawError?.message === 'Missing Permissions' || e.rawError?.message === 'Missing Access') {
        return
      }

      logger.error(e)
    }
  })

  client.on('messageCreate', async (message) => {
    if (message.author.bot || message.system) return

    try {
      const region = sellChannels[message.channelId]?.region

      if (region) {
        if (isSellMessage(message)) {
          await updateSchedule(message)

          await createMessages()
        }
      }
    } catch (e: any) {
      if (e.rawError?.message === 'Missing Permissions') {
        return
      }

      logger.error(e)
    }
  })

  client.on('messageDelete', async (message) => {
    const index = schedule.findIndex((value) => value.id === message.id)

    if (index < 0) {
      return
    }

    schedule.splice(index, 1)
    if (gcal.clientIsValid())
      gcal.deleteEvent(message.id).catch((e) => logger.error(`Error while trying to delete event: ${e}`))

    await createMessages()
  })

  client.on('messageDeleteBulk', async (messages) => {
    messages.each((message) => {
      const index = schedule.findIndex((value) => value.id === message.id)

      if (index < 0) {
        return
      }

      schedule.splice(index, 1)
      if (gcal.clientIsValid())
        gcal.deleteEvent(message.id).catch((e) => logger.error(`Error while trying to delete event: ${e}`))
    })

    await createMessages()
  })

  client.on('messageUpdate', async (_, updatedMessage) => {
    // If something was updated and now matches, add it
    if (sellChannels[updatedMessage.channelId]) {
      if (updatedMessage.partial) {
        updatedMessage = await updatedMessage.fetch()
      }

      if (isSellMessage(updatedMessage)) {
        await updateSchedule(updatedMessage)

        await createMessages()
      }
    }
  })

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) {
      return
    }

    if (isStarting) {
      await interaction.reply({
        content: "I'm still booting, please try again in at least 10 seconds.",
        ephemeral: true,
      })
      return
    }

    try {
      const id = interaction.customId

      if (id.startsWith('my-schedule-')) {
        await interaction.deferReply({
          ephemeral: true,
        })

        const regions = id.replace('my-schedule-', '').split('-')

        const result = schedule.filter((message) => {
          return message.reactorIds.includes(interaction.user.id) && regions.includes(message.region)
        })

        logger.debug(`Found ${result.length} items for user ${interaction.user.id}, result: ${JSON.stringify(result)}`)

        if (!result.length) {
          await interaction.editReply({
            content: "You didn't sign up to anything!",
          })
        } else {
          await interaction.editReply({
            content: getPrunedOutput(result, true, false)[0].join('\r\n\r\n'),
          })
        }
      }
    } catch (e: any) {
      logger.error(`Sell-schedule reply failed: ${e.rawError?.message}` || 'Something went wrong?')

      if (e.rawError?.message !== 'Unknown interaction') {
        logger.error(e)
      }

      try {
        await interaction.editReply({
          content: 'Oops, there was an error loading your schedule',
        })
        return
      } catch {
        logger.error('--- ERROR: Was not allowed to reply to interaction ---')
      }
    }
  })

  client.on('messageReactionAdd', async (reaction, user) => {
    const matchingHistoryItem = schedule.find((item) => item.id === reaction.message.id)

    logger.debug(
      `Reaction added: ${reaction.emoji.name} [${reaction.emoji.id}], user: ${user.username}, in schedule: ${!!matchingHistoryItem}`,
    )

    if (!matchingHistoryItem || reaction.emoji.id !== MCMysticCoinEmoji) {
      return
    }
    matchingHistoryItem.reactorIds.push(user.id)
    updateSchedule(await reaction.message.fetch())
  })

  client.on('messageReactionRemove', async (reaction, user) => {
    const matchingHistoryItem = schedule.find((item) => item.id === reaction.message.id)

    logger.debug(
      `Reaction removed: ${reaction.emoji.name} [${reaction.emoji.id}], user: ${user.username}, in schedule: ${!!matchingHistoryItem}`,
    )

    if (!matchingHistoryItem || reaction.emoji.id !== MCMysticCoinEmoji) {
      return
    }

    const index = matchingHistoryItem.reactorIds.indexOf(user.id)
    if (index > -1) {
      // only splice array when item is found
      matchingHistoryItem.reactorIds.splice(index, 1) // 2nd parameter means remove one item only
      updateSchedule(await reaction.message.fetch())
    }
  })

  async function updateSchedule(message: Message<boolean>) {
    // Parse the message
    const scheduleMessage: ScheduleMessage = await scheduleMessageParser.parseScheduleMessage(message, client)

    // Check if the message is already in the schedule
    const messageIndex = schedule.findIndex((oldmessage) => oldmessage.id === message.id)

    // If it is, update the date and text
    if (messageIndex !== -1) {
      schedule[messageIndex].date = scheduleMessage.date
      schedule[messageIndex].text = scheduleMessage.text

      // Update the calendar event
      if (gcal.clientIsValid()) {
        await gcal.updateEventFromScheduleMessage(schedule[messageIndex]).catch((e) => {
          logger.error(`Error while trying to update event: ${e}`)
        })
        // Add the event to all reactors' calendars
        for (const reactorId of schedule[messageIndex].reactorIds) {
          const reactor = await client.users.fetch(reactorId)
          await gcal.addEventToUserCalendar(schedule[messageIndex], reactor.username).catch((e) => {
            logger.error(`Error while trying to add event to user calendar: ${e}`)
          })
        }
      }
      return
    }

    // If it isn't, add it to the schedule
    schedule.push(scheduleMessage)

    // Create/update the calendar event
    if (gcal.clientIsValid()) {
      await gcal.createEventFromScheduleMessage(scheduleMessage, gcal.getCalendarIds()['main']).catch((e) => {
        logger.error(`Error while trying to create event: ${e}`)
      })
      await gcal
        .createEventFromScheduleMessage(scheduleMessage, gcal.getCalendarIds()[scheduleMessage.region])
        .catch((e) => {
          logger.error(`Error while trying to create event: ${e}`)
        })
    }
  }

  async function createMessages() {
    const queueFunction = async () => {
      if (writtenSchedule.length === schedule.length) {
        const currentMap = schedule.map((item) => {
          return item.id + item.date + item.text
        })

        let isDifferent = false

        for (let i = 0; i < currentMap.length; i++) {
          const item = currentMap[i]

          if (item !== writtenSchedule[i]) {
            isDifferent = true
            break
          }
        }

        if (!isDifferent) {
          return
        }
      }

      for (let i = 0; i < scheduleChannelIds.length; i++) {
        const channelInfo = scheduleChannelIds[i]

        const channel = client.channels.cache.get(channelInfo.id) as TextChannel | undefined

        if (!channel) {
          logger.error(`--- ERROR: Channel not found to post sell-schedule ${channelInfo.regions.join('-')} ---`)
          continue
        }

        const messages = (await channel.messages.fetch()).filter((message) => message.author.id === client.user?.id)

        for (let i = 0; i < messages.size; i++) {
          const messageToDelete = messages.at(i)

          await messageToDelete?.delete().catch(() => {})
        }

        const regionSchedule = schedule.filter((message) => channelInfo.regions.includes(message.region))

        if (regionSchedule.length === 0) {
          return channel.send(NO_SELLS_COMMENTS[Math.round(Math.random() * NO_SELLS_COMMENTS.length)])
        }

        const result = getPrunedOutput(regionSchedule)

        const myScheduleButton = new ButtonBuilder()
          .setCustomId(`my-schedule-${channelInfo.regions.join('-')}`)
          .setLabel('My Schedule')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('📅')

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(myScheduleButton)

        for (let i = 0; i < result.length; i++) {
          const schedule = result[i]

          await channel.send({
            content: schedule.join('\r\n\r\n'),
            ...(i === result.length - 1 && { components: [row] }),
          })
        }
      }

      writtenSchedule = schedule.map((item) => {
        return item.id + item.date + item.text
      })
    }

    q.push(queueFunction)
  }
}

export function isSellMessage(message: Message<boolean>): boolean {
  const match = new RegExp(DiscordTimeStampRegex).exec(message.content)
  if (!match) {
    return false
  }
  if (match.groups?.before === '' && match.groups?.after === '') {
    return false
  }
  return true
}

function getPrunedOutput(history: ScheduleMessage[], addSubtext = false, includeCalendarLink = false): string[][] {
  history.sort((a, b) => a.date - b.date)

  let hasAddedSubText = false

  const result = history.reduce<{ length: number; position: number; output: string[][] }>(
    (cum, message, index) => {
      const newText = `<t:${message.date}:F> ${message.text} ${message.url} ${includeCalendarLink && message.calendarEvent ? `[<:google_calendar:${GCalEmoji}>](<${google(message.calendarEvent)}>)` : ''}`

      if (hasAddedSubText) {
        return cum
      }

      if (cum.output.length - 1 < cum.position) {
        cum.output.push([])

        if (index !== 0) {
          const split = '-------------------------'
          cum.output[cum.position].push(split)
          cum.length += split.length
        }
      }

      // Message limit is 2000
      if (cum.length + newText.length >= 1900) {
        if (addSubtext) {
          hasAddedSubText = true
          cum.output[cum.position].push(`⚠️ ${history.length - index} items not displayed ⚠️`)
        }

        cum.position++
        cum.length = 0

        return cum
      }

      // TODO: Split on newline and only add the first line, but what is a newline in discord?
      cum.output[cum.position].push(newText)

      return {
        length: cum.length + newText.length,
        position: cum.position,
        output: cum.output,
      }
    },
    {
      length: 0,
      position: 0,
      output: [],
    },
  )

  return result.output
}

type ScheduleMessage = {
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

const NO_SELLS_COMMENTS = [
  'Loading History...',
  'No sells going, time to sign up as a hustler by PM-ing Dubious Detective!',
  'Nothing to see here, move along.',
  'Khajit has no wares because buyers have no coin.',
  'One small step for man, one empty sell list for mankind.',
  "The sell list is as empty as a goblin's heart.",
  "Silence in the marketplace... eerie, isn't it?",
  'No transactions today. The vault sleeps.',
  'All quiet on the selling front.',
  'Not a single sell in sight. Must be a holiday.',
  'No sells today, just tumbleweeds.',
  'The sell list is on vacation. Please check back later.',
  'Even the buyer took the day off.',
  "The market is as still as a dragon's lair.",
  'Zero sells. Time to sharpen your blades instead.',
  'The sell list is a blank canvas today.',
  'Nothing here. Did we miss a memo?',
  'No sells yet. Maybe you can change that?',
  "sup, i really liked the sells i joined with you, but you guys are just memeing too much in discord chats for my taste.\nsince i can't make the whole guild only use meme channel for memes you can kick me as im not fitting in\nfarewell whoever didnt meme and fuck you memers  -sh/severin/SeVeRiNhD.7195",
  "Team sorry for my past unreliable behaviour, I can see how I have triggered people with it and I can understand it, forgetting about a sell is tbh unacceptable (or just coming late and potentially causing us to lose buyers).\nFor what it's worth I've had quite a bit of irl stress but as an adult I should be capable of handling it and its not an excuse, just to explain.\nI've dealt with everything and I'm happy to show you the respect u deserve\n& I'm thankful that I still have the opportunity to raid here ❤️ best sell guild eu no cap\nsry for ping :monkapls:",
  "@ everyone (didn't wanna ping and annoy ppl) \nI was made aware, that i lacked performance during sells by not being correctly geared. Breaking rule 8a).\nI got a corresponding penalty.\nThis message is mostly to apologize to everyone for therefore griefing sells, it did not happen with malicious intend, but it happend. \nTherefor my sincere apology to everyone 🙇",
  "OwO Good luck on your exam!  You're gonna ace it!  I believe in you!  💖✨ \n\nRemember to stay calm and focused, and you'll do amazing!  Fighting!  💪💖",
  "You know what, Chase Chonker, I think it's time for a break from this.  I'm going to mute you.  I need to take a break from this.  I'm going to mute you.  I need to take a break from this.  You know what, Chase Chonker, I think it's time for a break from this.  I'm going to mute you.  I need to take a break from this.  I'm going to mute you.  I need to take a break from this. You know what, Chase Chonker,",
]
