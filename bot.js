import { config } from "dotenv"
import { Client, GatewayIntentBits, Partials } from "discord.js"
import allowedChannels from "./constants/allowedChannels.js"
import MaxDebug from "./onMessageCreateHooks/0.debug.js"
import StartSellThread from "./onMessageCreateHooks/1.startSellThread.js"
import ReplyAsGemini from "./onMessageCreateHooks/2.replyAsGemini.js"
import BestAeon from "./onMessageCreateHooks/3.bestAeon.js"
import BestMax from "./onMessageCreateHooks/4.bestMax.js"
import AustrianNow from "./onMessageCreateHooks/5.austrianNow.js"
import WhatsDn from "./onMessageCreateHooks/6.whatsDn.js"
import HelloIAm from "./onMessageCreateHooks/7.helloIAm.js"

config()

const TOKEN = process.env.TESTTOKEN
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
})

let maxCounter = {
  value: 1,
}

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`)
})

client.on("messageCreate", async (message) => {
  if (message.author.bot || message.system) return

  try {
    const messageText = message.content.toLowerCase()

    if (await MaxDebug(messageText, message, maxCounter)) {
      return
    }

    if (await StartSellThread(messageText, message)) {
      return
    }

    if (await ReplyAsGemini(client, message)) {
      return
    }

    if (await BestAeon(message)) {
      return
    }

    if (await BestMax(messageText, message, maxCounter)) {
      return
    }

    if (await AustrianNow(messageText, message)) {
      return
    }

    if (await WhatsDn(messageText, message)) {
      return
    }

    if (await HelloIAm(client, message)) {
      return
    }
  } catch (e) {
    if (e.message === "Missing Permissions") {
      return
    }

    console.error(e)
  }
})

client.on("messageReactionAdd", async (reaction, user) => {
  if (reaction.partial) {
    try {
      await reaction.fetch()
    } catch (error) {
      console.error("Something went wrong when fetching the message:", error)
      return
    }
  }

  if (!allowedChannels[reaction.message.channelId]) {
    return
  }

  if (user.partial) {
    try {
      await user.fetch()
    } catch (error) {
      console.error("Something went wrong when fetching the user:", error)
      return
    }
  }

  if (!reaction.message.hasThread) {
    return
  }

  const thread = reaction.message.thread

  try {
    await thread.members.fetch()
    const isMember = thread.members.cache.has(user.id)

    if (!isMember) {
      await thread.members.add(user)
      console.log("added", user.displayName, "to a thread")
    }
  } catch (error) {
    console.error("Error checking thread membership:", error)
    console.warn(e.message)
  }
})

client.login(TOKEN)
