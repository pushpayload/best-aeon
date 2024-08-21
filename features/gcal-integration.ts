import * as fs from 'fs'
import * as path from 'path'
import * as process from 'process'
import { google, Auth, calendar_v3 } from 'googleapis'
import { authenticate } from '@google-cloud/local-auth'
import { OAuth2Client } from 'google-auth-library'
import { Logger } from '../helpers/logger.ts'
import { config } from 'dotenv'
import { GaxiosResponse } from 'gaxios'
import { ScheduleMessage } from '../helpers/scheduleMessageParser.ts'

config()

/**
 * A class to interact with Google Calendar.
 * @class GcalIntegration
 * @example const gcalIntegration = new GcalIntegration()
 * @example gcalIntegration.initialize()
 * @example gcalIntegration.listEvents()
 * @example gcalIntegration.listCalendars()
 * @example gcalIntegration.createEventFromScheduleMessage(scheduleMessage)
 * @example gcalIntegration.createEventFromScheduleMessage(scheduleMessage, 'primary')
 * @example gcalIntegration.createEventFromScheduleMessage(scheduleMessage, 'calendarId')
 */
export default class GcalIntegration {
  logger: Logger = new Logger({ functionName: 'GcalIntegration' })
  constructor() {}

  // If modifying these scopes, delete token.json.
  SCOPES: string[] = ['https://www.googleapis.com/auth/calendar']
  // The file token.json stores the user's access and refresh tokens, and is
  // created automatically when the authorization flow completes for the first time.
  TOKEN_PATH: string = path.join(process.cwd(), 'token.json')
  CREDENTIALS_PATH: string = path.join(process.cwd(), 'credentials.json')

  client: OAuth2Client | undefined

  /**
   * Initializes the Google Calendar integration.
   * If credentials.json does not exist, it will be created from process.env.G_CLIENT_ID and process.env.G_CLIENT_SECRET.
   * If token.json does not exist, the user will be prompted to authorize the client.
   * If token.json exists, the client will be loaded from it.
   * @returns {Promise<void>}
   */
  async initialize(): Promise<void> {
    if (!fs.existsSync(this.CREDENTIALS_PATH)) {
      this.logger.error('Error: credentials.json not found.')
      // create credentials.json from process.env.G_CLIENT_ID and process.env.G_CLIENT_SECRET
      const credentials = {
        installed: {
          client_id: process.env.G_CLIENT_ID,
          project_id: process.env.G_PROJECT_ID,
          auth_uri: 'https://accounts.google.com/o/oauth2/auth',
          token_uri: 'https://oauth2.googleapis.com/token',
          auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
          client_secret: process.env.G_CLIENT_SECRET,
          redirect_uris: ['http://localhost'],
        },
      }
      // save credentials.json
      await fs.promises.writeFile(this.CREDENTIALS_PATH, JSON.stringify(credentials))
    }
    const authClient = await this.authorize().catch((err) => {
      this.logger.error(err)
    })
    if (!authClient) {
      throw new Error('Could not authorize client.')
    }
    this.client = authClient
    return
  }

  /**
   * Reads previously authorized credentials from the save file.
   *
   * @return {Promise<OAuth2Client|void>}
   */
  async loadSavedCredentialsIfExist(): Promise<OAuth2Client | void> {
    try {
      const content: string = await fs.promises.readFile(this.TOKEN_PATH, 'utf-8')
      const credentials: any = JSON.parse(content)
      const auth = google.auth.fromJSON(credentials)
      return auth as OAuth2Client
    } catch (err) {
      return
    }
  }

  /**
   * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
   *
   * @param {OAuth2Client} client
   * @return {Promise<void>}
   */
  async saveCredentials(client: OAuth2Client): Promise<void> {
    const content: string = await fs.promises.readFile(this.CREDENTIALS_PATH, 'utf-8')
    const keys: any = JSON.parse(content)
    const key: any = keys.installed || keys.web
    const payload: string = JSON.stringify({
      type: 'authorized_user',
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: client.credentials.refresh_token,
    })
    await fs.promises.writeFile(this.TOKEN_PATH, payload)
  }

  /**
   * Load or request or authorization to call APIs.
   *
   */
  async authorize(): Promise<OAuth2Client> {
    let client: OAuth2Client | void = await this.loadSavedCredentialsIfExist()
    if (client) {
      return client
    }
    client = await authenticate({
      scopes: this.SCOPES,
      keyfilePath: this.CREDENTIALS_PATH,
    })
    if (client.credentials) {
      await this.saveCredentials(client)
    }
    return client
  }

  /**
   * Lists the next 10 events on the user's specified calendar.
   * @param {string=} [calendarId='primary'] - The calendar ID to list events from.
   * @returns {Promise<void | calendar_v3.Schema$Event[]>}
   * @example listEvents('primary')
   * @example listEvents('calendarId')
   * @example listEvents()
   */
  async listEvents(calendarId?: string): Promise<void | calendar_v3.Schema$Event[]> {
    if (!this.client) throw new Error('Error: No client found, please initialize.')
    if (!calendarId) calendarId = 'primary' // default calendar
    const calendar: calendar_v3.Calendar = google.calendar({ version: 'v3', auth: this.client })

    const res: any = await calendar.events.list({
      calendarId,
      timeMin: new Date().toISOString(),
      maxResults: 10,
      singleEvents: true,
      orderBy: 'startTime',
    })
    const events: calendar_v3.Schema$Event[] | undefined = res.data.items
    if (!events || events.length === 0) {
      this.logger.debug('No upcoming events found.')
      return
    }
    this.logger.debug('Upcoming 10 events:')
    events.map((event: calendar_v3.Schema$Event, i: number) => {
      const start: string = event.start!.dateTime! || event.start!.date!
      this.logger.debug(`id: ${event.id} ${start} - ${event.summary}`)
      if (i > 10) return
    })
    return events
  }

  /**
   * Lists the user's calendars.
   * @returns {Promise<void | calendar_v3.Schema$CalendarList>}
   * @example listCalendars()
   */
  async listCalendars(): Promise<void | calendar_v3.Schema$CalendarList> {
    if (!this.client) throw new Error('Error: No client found, please initialize.')
    const calendar: calendar_v3.Calendar = google.calendar({ version: 'v3', auth: this.client })

    const res = await calendar.calendarList.list()
    const calendars: calendar_v3.Schema$CalendarList | undefined = res.data
    if (!calendars || !calendars.items || calendars.items.length === 0) {
      this.logger.debug('No calendars found.')
      return
    }
    this.logger.debug(`Calendars: ${calendars.items.map((calendar) => calendar.summary).join(', ')}`)
    return calendars
  }

  /**
   *
   */

  /**
   * Creates a new event, based on a ScheduleMessage on the specified calendar.
   * @param {ScheduleMessage} scheduleMessage - The schedule message to create the event from.
   * @param {string=} [calendarId='primary'] - The calendar ID to create the event on.
   * @returns {Promise<void | GaxiosResponse<calendar_v3.Schema$Event>>}
   * @example createEventFromScheduleMessage(scheduleMessage, 'primary')
   * @example createEventFromScheduleMessage(scheduleMessage, 'calendarId')
   * @example createEventFromScheduleMessage(scheduleMessage)
   */
  async createEventFromScheduleMessage(
    scheduleMessage: ScheduleMessage,
    calendarId?: string,
  ): Promise<void | GaxiosResponse<calendar_v3.Schema$Event>> {
    if (!scheduleMessage.calendarEvent) {
      // no calendar event
      this.logger.error(`No calendar event found in message with id ${scheduleMessage.id}.`)
      return
    }

    if (!calendarId) calendarId = 'primary' // default calendar

    // Get a calendar instance
    const calendar: calendar_v3.Calendar = google.calendar({ version: 'v3', auth: this.client })

    // Create a new event resource
    const resource: calendar_v3.Schema$Event = {
      id: scheduleMessage.id,
      summary: scheduleMessage.calendarEvent.title,
      location: scheduleMessage.calendarEvent.location,
      description: scheduleMessage.calendarEvent.description,
      start: {
        dateTime: scheduleMessage.calendarEvent.start.toISOString(),
        timeZone: scheduleMessage.calendarEvent.start.format('Z'),
      },
      end: {
        dateTime: scheduleMessage.calendarEvent.end.toISOString(),
        timeZone: scheduleMessage.calendarEvent.end.format('Z'),
      },
    }

    // Insert the event
    const insertedEvent: void | GaxiosResponse<calendar_v3.Schema$Event> = await calendar.events
      .insert({
        calendarId,
        requestBody: resource,
      })
      .catch((err: any) => {
        this.logger.error(err)
      })
    this.logger.debug('Event created: %s', insertedEvent?.data?.htmlLink)
    return insertedEvent
  }
}
