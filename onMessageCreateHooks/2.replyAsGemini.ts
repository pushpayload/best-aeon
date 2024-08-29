import { User, Client, Message, userMention } from 'discord.js'
import { handleMessage } from './utility/gemini.ts'
import { timeoutReactions } from '../constants/timeoutReactions.ts'
import { ErrorCodes } from '../constants/errorCodes.ts'

const timeoutReactionsLength: number = timeoutReactions.length

let lastGeminiCallTime: number = 0

export default async function onMessageCreate(client: Client, message: Message): Promise<boolean> {
  if (client.user && message.mentions.has(client.user.id)) {
    const now: number = Date.now()

    if (now - lastGeminiCallTime < 5000) {
      const reactions: string = timeoutReactions[Math.round(Math.random() * timeoutReactionsLength)]

      await message.channel.send(reactions)
      return true
    }

    let filteredMessage: string = message.content.replace(userMention(client.user.id), '')

    message.mentions.users.each((user: User) => {
      filteredMessage = filteredMessage.replace(userMention(user.id), user.globalName ? user.globalName : user.username)
    })

    try {
      lastGeminiCallTime = now

      const reply: string = (await handleMessage(filteredMessage)).replace('@', '')

      if (reply) {
        await message.channel.send(reply)
      } else {
        await message.channel.send(ErrorCodes.GeneralReplyError)
      }
    } catch (e: any) {
      if (e.rawError?.message === 'Missing Permissions') {
        return true
      }

      console.error(e)
      await message.channel.send(ErrorCodes.GeneralReplyError)
    }

    return true
  }

  return false
}
