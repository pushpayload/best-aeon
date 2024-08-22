import * as fs from 'fs'
import * as path from 'path'
import * as process from 'process'
import { google, Auth, calendar_v3 } from 'googleapis'
import { authenticate } from '@google-cloud/local-auth'
import { OAuth2Client } from 'google-auth-library'
import { Logger, LogLevel } from '../helpers/logger.ts'
import { config } from 'dotenv'
import { GaxiosResponse, GaxiosError } from 'gaxios'
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
  private logger: Logger = new Logger({ functionName: 'GcalIntegration', logLevel: LogLevel.debug })
  constructor() {}

  // If modifying these scopes, delete token.json.
  SCOPES: string[] = ['https://www.googleapis.com/auth/calendar']
  // The file token.json stores the user's access and refresh tokens, and is
  // created automatically when the authorization flow completes for the first time.
  TOKEN_PATH: string = path.join(process.cwd(), 'token.json')
  CREDENTIALS_PATH: string = path.join(process.cwd(), 'credentials.json')

  client: OAuth2Client | undefined
  calendarIds: { [key: string]: string } = {}

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
    const gcal: calendar_v3.Calendar = google.calendar({ version: 'v3', auth: this.client })

    const events: calendar_v3.Schema$Event[] | undefined = (
      await gcal.events.list({
        calendarId,
        timeMin: new Date().toISOString(),
        maxResults: 10,
        singleEvents: true,
        orderBy: 'startTime',
      })
    ).data.items
    if (!events || events.length === 0) {
      this.logger.info('No upcoming events found.')
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
    const gcal: calendar_v3.Calendar = google.calendar({ version: 'v3', auth: this.client })

    const calendars: calendar_v3.Schema$CalendarList | undefined = (await gcal.calendarList.list()).data
    if (!calendars || !calendars.items || calendars.items.length === 0) {
      this.logger.info('No calendars found.')
      return
    }
    this.logger.debug(`Calendars: ${calendars.items.map((calendar) => calendar.summary).join(', ')}`)
    return calendars
  }

  /**
   * Sets up one main calendar for the entire schedule, one calendar per region, and one calendar per user.
   * @returns {Promise<void>}
   * @example setupCalendars()
   */
  async setupCalendars(): Promise<void> {
    if (!this.client) throw new Error('Error: No client found, please initialize.')

    const calendars: void | calendar_v3.Schema$CalendarList = await this.listCalendars()
    if (calendars && calendars.items && calendars.items.length > 0) {
      // check if main calendar exists
      const mainCalendar: calendar_v3.Schema$Calendar | void = calendars.items.find((calendar) => {
        return calendar.summary === 'Rise Schedule'
      })
      if (mainCalendar) {
        this.logger.info('Main calendar exists.')
        if (mainCalendar && mainCalendar.id) {
          this.calendarIds['main'] = mainCalendar.id
        } else {
          throw new Error('Could not retrieve main calendar ID.')
        }
      } else {
        await this.createMainCalendar()
      }

      const regions: string[] = ['NA', 'EU']
      regions.forEach(async (region: string) => {
        // check if region calendar exists
        const regionCalendar: calendar_v3.Schema$Calendar | void = calendars.items?.find((calendar) => {
          return calendar.summary === `Rise Schedule - ${region}`
        })
        if (regionCalendar) {
          this.logger.info(`${region} calendar exists.`)
          if (regionCalendar && regionCalendar.id) {
            this.calendarIds[region] = regionCalendar.id
          } else {
            throw new Error(`Could not retrieve ${region} calendar ID.`)
          }
        } else {
          await this.createRegionCalendar(region)
        }
      })
    }
    this.logger.debug('Calendar IDs: ', this.calendarIds)
  }

  /**
   * Creates a main calendar for the entire schedule.
   * @returns {Promise<void>}
   * @example createMainCalendar()
   */
  async createMainCalendar() {
    if (!this.client) throw new Error('Error: No client found, please initialize.')
    const gcal: calendar_v3.Calendar = google.calendar({ version: 'v3', auth: this.client })

    // Create main calendar
    const mainCalendar: calendar_v3.Schema$Calendar = {
      summary: 'Rise Schedule',
      description: 'Main calendar for the Rise schedule.',
      timeZone: 'Europe/Amsterdam',
    }
    const mainCalendarRes: GaxiosResponse<calendar_v3.Schema$Calendar> | void = await gcal.calendars
      .insert({
        requestBody: mainCalendar,
      })
      .catch((err: any) => {
        this.logger.error(err)
      })
    if (!mainCalendarRes) this.logger.error('Could not create main calendar.')
    else {
      this.logger.debug('Main calendar created: %s', mainCalendarRes.data.id)
      if (mainCalendarRes.data && mainCalendarRes.data.id) {
        this.calendarIds['main'] = mainCalendarRes.data.id
      } else {
        throw new Error('Could not retrieve main calendar ID.')
      }
    }
  }

  /**
   * Creates a region calendar for the specified region.
   * @param region
   * @returns {Promise<void>}
   * @example createRegionCalendar('NA')
   * @example createRegionCalendar('EU')
   */
  async createRegionCalendar(region: string) {
    if (!this.client) throw new Error('Error: No client found, please initialize.')
    const gcal: calendar_v3.Calendar = google.calendar({ version: 'v3', auth: this.client })

    // Create region calendar
    const regionCalendar: calendar_v3.Schema$Calendar = {
      summary: `Rise Schedule - ${region}`,
      description: `Calendar for the Rise schedule for region ${region}.`,
      timeZone: 'Europe/Amsterdam',
    }
    const regionCalendarRes: GaxiosResponse<calendar_v3.Schema$Calendar> | void = await gcal.calendars
      .insert({
        requestBody: regionCalendar,
      })
      .catch((err: any) => {
        this.logger.error(err)
      })
    if (!regionCalendarRes) this.logger.error(`Could not create ${region} calendar.`)
    else {
      this.logger.debug(`${region} calendar created: %s`, regionCalendarRes.data.id)
      if (regionCalendarRes.data && regionCalendarRes.data.id) {
        this.calendarIds[region] = regionCalendarRes.data.id
      } else {
        throw new Error(`Could not retrieve ${region} calendar ID.`)
      }
    }
  }

  /**
   * Creates a calendar for the specified user.
   * @param {string} username - The username to create the calendar for.
   * @returns {Promise<void>}
   * @example createUserCalendar('username')
   */
  async createUserCalendar(username: string) {
    if (!this.client) throw new Error('Error: No client found, please initialize.')
    // Check if user calendar exists
    const calendars: void | calendar_v3.Schema$CalendarList = await this.listCalendars()
    if (calendars && calendars.items && calendars.items.length > 0) {
      const userCalendar: calendar_v3.Schema$Calendar | void = calendars.items.find((calendar) => {
        return calendar.summary === `Rise Schedule - ${username}`
      })
      if (userCalendar) {
        this.logger.info(`${username} calendar exists.`)
        return
      }
    }
    const gcal: calendar_v3.Calendar = google.calendar({ version: 'v3', auth: this.client })

    // Create user calendar
    const userCalendar: calendar_v3.Schema$Calendar = {
      summary: `Rise Schedule - ${username}`,
      description: `Calendar for the Rise schedule for user ${username}.`,
      timeZone: 'Europe/Amsterdam',
    }
    const userCalendarRes: GaxiosResponse<calendar_v3.Schema$Calendar> | void = await gcal.calendars
      .insert({
        requestBody: userCalendar,
      })
      .catch((err: any) => {
        this.logger.error(err)
      })
    if (!userCalendarRes) this.logger.error(`Could not create ${username} calendar.`)
    else this.logger.debug(`${username} calendar created: %s`, userCalendarRes.data.id)
  }

  /**
   * Creates a new event, based on a ScheduleMessage on the specified calendar.
   * If the event already exists, it will be updated.
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

    // Check if the event already exists
    const event: void | calendar_v3.Schema$Event[] = (
      await calendar.events.list({
        calendarId,
      })
    ).data.items

    if (event && event.length > 0 && event.find((e) => e.id === scheduleMessage.id)) {
      this.logger.info(`Event ${scheduleMessage.calendarEvent.title}  with id: ${scheduleMessage.id} already exists.`)
      // Update the event
      const resource: calendar_v3.Schema$Event = {
        id: scheduleMessage.id,
        summary: scheduleMessage.calendarEvent.title,
        location: scheduleMessage.calendarEvent.location,
        description: scheduleMessage.calendarEvent.description,
        start: {
          dateTime: new Date(scheduleMessage.calendarEvent.start).toISOString(),
          timeZone: 'Europe/Amsterdam',
        },
        end: {
          dateTime: new Date(scheduleMessage.calendarEvent.end).toISOString(),
          timeZone: 'Europe/Amsterdam',
        },
      }
      const updatedEvent: void | GaxiosResponse<calendar_v3.Schema$Event> = await calendar.events
        .update({
          calendarId,
          eventId: scheduleMessage.id,
          requestBody: resource,
        })
        .catch((err: any) => {
          this.logger.error(err)
        })
      this.logger.debug(`Event ${updatedEvent?.data?.summary} updated: ${updatedEvent?.data?.htmlLink}`)
      return updatedEvent
    }

    // Create a new event resource
    const resource: calendar_v3.Schema$Event = {
      id: scheduleMessage.id,
      summary: scheduleMessage.calendarEvent.title,
      location: scheduleMessage.calendarEvent.location,
      description: scheduleMessage.calendarEvent.description,
      start: {
        dateTime: new Date(scheduleMessage.calendarEvent.start).toISOString(),
        timeZone: 'Europe/Amsterdam',
      },
      end: {
        dateTime: new Date(scheduleMessage.calendarEvent.end).toISOString(),
        timeZone: 'Europe/Amsterdam',
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
    this.logger.debug(`Event ${insertedEvent?.data?.summary} created: ${insertedEvent?.data?.htmlLink}`)
    return insertedEvent
  }

  async deleteEvent(eventId: string, calendarId?: string): Promise<void> {
    if (!calendarId) {
      // remove event from all calendars
      const calendarList = await this.listCalendars()
      if (calendarList && calendarList.items) {
        calendarList.items.forEach(async (event) => {
          if (event.id) {
            await this.deleteEvent(eventId, event.id).catch((err) => {
              if (err instanceof GaxiosError && err.status === 404) {
                // Just ignore 404 errors because we loop over all calendars
                // without checking if the event exists in the calendar
              } else this.logger.error(err)
            })
          }
        })
      }
      return
    }

    // Get a calendar instance
    const calendar: calendar_v3.Calendar = google.calendar({ version: 'v3', auth: this.client })

    // Delete the event
    await calendar.events
      .delete({
        calendarId,
        eventId,
      })
      .catch((err: any) => {
        this.logger.error(err)
      })
    this.logger.debug(`Event ${eventId} deleted.`)
  }
}
