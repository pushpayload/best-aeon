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
  constructor(prefix?: string) {
    if (prefix) {
      this.CALENDAR_PREFIX = prefix
    }
  }

  // If modifying these scopes, delete token.json.
  SCOPES: string[] = ['https://www.googleapis.com/auth/calendar']
  // The file token.json stores the user's access and refresh tokens, and is
  // created automatically when the authorization flow completes for the first time.
  private TOKEN_PATH: string = path.join(process.cwd(), 'token.json')
  private CREDENTIALS_PATH: string = path.join(process.cwd(), 'credentials.json')

  private CLIENT: OAuth2Client | undefined

  protected CALENDAR_IDS: { [key: string]: string } = {}
  protected CALENDAR_PREFIX: string = 'Rise Schedule'

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

    // save client
    this.saveCredentials(authClient)

    this.CLIENT = authClient
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

      // Check if the token is expired
      if (credentials.expiry_date) {
        this.logger.info(`Token expiry date: ${new Date(credentials.expiry_date).toISOString()}`)
        if (credentials.expiry_date < new Date().getTime()) {
          this.logger.info('Token expired. Trying to refresh token.')
        }
      }

      if (!this.clientIsValid(auth as OAuth2Client)) {
        return
      }

      return auth as OAuth2Client
    } catch (err) {
      this.logger.error(err)
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
      expiry_date: client.credentials.expiry_date,
    })
    this.logger.debug(`Saving token ${payload} to ${this.TOKEN_PATH}`)
    await fs.promises.writeFile(this.TOKEN_PATH, payload)
  }

  /**
   * Load or request or authorization to call APIs.
   *
   */
  async authorize(): Promise<OAuth2Client> {
    let client: OAuth2Client | void = await this.loadSavedCredentialsIfExist().catch((err) => {
      this.logger.error(err)
    })
    if (client) {
      return client
    }
    client = await authenticate({
      scopes: this.SCOPES,
      keyfilePath: this.CREDENTIALS_PATH,
    })
    return client
  }

  /**
   * Check if the current client is authorized.
   */
  clientIsValid(auth?: Auth.OAuth2Client): boolean {
    if (!auth && !this.CLIENT) {
      this.logger.error('Error: No client found, please initialize.')
      return false
    }
    if (!auth && this.CLIENT) {
      auth = this.CLIENT
    }
    if (!auth) return false

    // Perform a test call to see if the token is still valid
    const at = auth
      .getAccessToken()
      .then((atRes) => {
        return atRes
      })
      .catch((err) => {
        if (err instanceof GaxiosError && err.response?.data?.error === 'invalid_grant') {
          this.logger.error('Invalid grant error. Token expired.')
          return
        }
        this.logger.error(err)
        return
      })
    if (!at) {
      // Token expired return undefined
      this.logger.error('Token expired.')
      return false
    }
    return true
  }

  /**
   * returns the CALENDAR_IDS object.
   * @returns {Object.<string, string>}
   */
  getCalendarIds(): { [key: string]: string } {
    return this.CALENDAR_IDS
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
    if (!this.CLIENT) throw new Error('Error: No client found, please initialize.')
    if (!calendarId) calendarId = 'primary' // default calendar
    const gcal: calendar_v3.Calendar = google.calendar({ version: 'v3', auth: this.CLIENT })

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
    if (!this.CLIENT) throw new Error('Error: No client found, please initialize.')
    const gcal: calendar_v3.Calendar = google.calendar({ version: 'v3', auth: this.CLIENT })

    // Get all calendars
    const calendars: calendar_v3.Schema$CalendarList | undefined = (await gcal.calendarList.list()).data
    if (!calendars || !calendars.items || calendars.items.length === 0) {
      this.logger.info('No calendars found.')
      return
    }

    // Filter out calendars we have write access to
    calendars.items = calendars.items.filter((calendar) => {
      return calendar.accessRole === 'owner' || calendar.accessRole === 'writer'
    })

    this.logger.debug(`Calendars: ${calendars.items.map((calendar) => calendar.summary).join(', ')}`)
    return calendars
  }

  /**
   * Sets up one main calendar for the entire schedule, one calendar per region, and one calendar per user.
   * @returns {Promise<void>}
   * @example setupCalendars()
   */
  async setupCalendars(): Promise<void> {
    if (!this.CLIENT) throw new Error('Error: No client found, please initialize.')

    const calendars: void | calendar_v3.Schema$CalendarList = await this.listCalendars()
    if (calendars && calendars.items && calendars.items.length > 0) {
      // check if main calendar exists
      const mainCalendar: calendar_v3.Schema$Calendar | void = calendars.items.find((calendar) => {
        return calendar.summary === this.CALENDAR_PREFIX
      })
      if (mainCalendar) {
        this.logger.info('Main calendar exists.')
        if (mainCalendar && mainCalendar.id) {
          this.CALENDAR_IDS['main'] = mainCalendar.id
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
          return calendar.summary === `${this.CALENDAR_PREFIX} - ${region}`
        })
        if (regionCalendar) {
          this.logger.info(`${region} calendar exists.`)
          if (regionCalendar && regionCalendar.id) {
            this.CALENDAR_IDS[region] = regionCalendar.id
          } else {
            throw new Error(`Could not retrieve ${region} calendar ID.`)
          }
        } else {
          await this.createRegionCalendar(region)
        }
      })
    }
    this.logger.debug('Calendar IDs: ', this.CALENDAR_IDS)
  }

  /**
   * Creates a main calendar for the entire schedule.
   * @returns {Promise<void>}
   * @example createMainCalendar()
   */
  async createMainCalendar() {
    if (!this.CLIENT) throw new Error('Error: No client found, please initialize.')
    const gcal: calendar_v3.Calendar = google.calendar({ version: 'v3', auth: this.CLIENT })

    // Create main calendar
    const mainCalendar: calendar_v3.Schema$Calendar = {
      summary: `${this.CALENDAR_PREFIX}`,
      description: `Main calendar for ${this.CALENDAR_PREFIX}.`,
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
      this.logger.debug(`Main calendar created: ${mainCalendarRes.data.id}`)
      if (mainCalendarRes.data && mainCalendarRes.data.id) {
        this.CALENDAR_IDS['main'] = mainCalendarRes.data.id
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
    if (!this.CLIENT) throw new Error('Error: No client found, please initialize.')
    const gcal: calendar_v3.Calendar = google.calendar({ version: 'v3', auth: this.CLIENT })

    // Create region calendar
    const regionCalendar: calendar_v3.Schema$Calendar = {
      summary: `${this.CALENDAR_PREFIX} - ${region}`,
      description: `Calendar for ${this.CALENDAR_PREFIX} for region ${region}.`,
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
      this.logger.debug(`${region} calendar created: ${regionCalendarRes.data.id}`)
      if (regionCalendarRes.data && regionCalendarRes.data.id) {
        this.CALENDAR_IDS[region] = regionCalendarRes.data.id
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
  async createUserCalendar(username: string): Promise<calendar_v3.Schema$Calendar | void> {
    if (!this.CLIENT) throw new Error('Error: No client found, please initialize.')
    // Check if user calendar exists
    const calendars: void | calendar_v3.Schema$CalendarList = await this.listCalendars()
    if (calendars && calendars.items && calendars.items.length > 0) {
      const userCalendar: calendar_v3.Schema$Calendar | void = calendars.items.find((calendar) => {
        return calendar.summary === `${this.CALENDAR_PREFIX} - User: ${username}`
      })
      if (userCalendar) {
        this.logger.info(`${username} calendar exists.`)
        return
      }
    }
    const gcal: calendar_v3.Calendar = google.calendar({ version: 'v3', auth: this.CLIENT })

    // Create user calendar
    const userCalendar: calendar_v3.Schema$Calendar = {
      summary: `${this.CALENDAR_PREFIX} - User: ${username}`,
      description: `Calendar for ${this.CALENDAR_PREFIX} for user ${username}.`,
      timeZone: 'Europe/Amsterdam',
    }
    const userCalendarRes: GaxiosResponse<calendar_v3.Schema$Calendar> | void = await gcal.calendars
      .insert({
        requestBody: userCalendar,
      })
      .catch((err: any) => {
        this.logger.error(err)
      })
    if (!userCalendarRes || !userCalendarRes.data) {
      this.logger.error(`Could not create ${username} calendar.`)
      return
    } else {
      this.logger.debug(`${username} calendar created: ${userCalendarRes.data.id}`)
      return userCalendarRes.data
    }
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
    const gcal: calendar_v3.Calendar = google.calendar({ version: 'v3', auth: this.CLIENT })

    // Check if the event already exists
    const event: void | calendar_v3.Schema$Event[] = (
      await gcal.events.list({
        calendarId,
      })
    ).data.items

    if (event && event.length > 0 && event.find((e) => e.id === scheduleMessage.id)) {
      this.logger.info(`Event ${scheduleMessage.calendarEvent.title}  with id: ${scheduleMessage.id} already exists.`)
      // Update the event
      return await this.updateEventFromScheduleMessage(scheduleMessage, calendarId)
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
    const insertedEvent: void | GaxiosResponse<calendar_v3.Schema$Event> = await gcal.events
      .insert({
        calendarId,
        requestBody: resource,
      })
      .catch((err: any) => {
        if (err instanceof GaxiosError && err.status === 409) {
          // Event already exists
          this.logger.info(`Event ${scheduleMessage.calendarEvent?.title} already exists.`)
          return
        }
        this.logger.error(err)
      })
    this.logger.debug(`Event ${insertedEvent?.data?.summary} created: ${insertedEvent?.data?.htmlLink}`)
    return insertedEvent
  }

  async updateEventFromScheduleMessage(scheduleMessage: ScheduleMessage, calendarId?: string) {
    // Get a calendar instance
    const gcal: calendar_v3.Calendar = google.calendar({ version: 'v3', auth: this.CLIENT })

    const resource: calendar_v3.Schema$Event = {
      id: scheduleMessage.id,
      summary: scheduleMessage.calendarEvent?.title,
      location: scheduleMessage.calendarEvent?.location,
      description: scheduleMessage.calendarEvent?.description,
      start: {
        dateTime: new Date(scheduleMessage.calendarEvent?.start).toISOString(),
        timeZone: 'Europe/Amsterdam',
      },
      end: {
        dateTime: new Date(scheduleMessage.calendarEvent?.end).toISOString(),
        timeZone: 'Europe/Amsterdam',
      },
    }

    // Check if calendarId is set, if not update event in all calendars
    if (!calendarId) {
      const calendarList = await this.listCalendars()
      if (calendarList && calendarList.items) {
        calendarList.items.forEach(async (calendar) => {
          // Only update events in calendars with the CALENDAR_PREFIX
          if (calendar.id && calendar.summary && calendar.summary.startsWith(this.CALENDAR_PREFIX)) {
            // Delete the event from usernames no longer in the scheduleMessage.reactorNames
            if (calendar.summary.startsWith(`${this.CALENDAR_PREFIX} - User:`)) {
              const username = calendar.summary.split(' - User: ')[1]
              if (!scheduleMessage.reactorNames.includes(username)) {
                await this.removeEventFromUserCalendar(scheduleMessage, username).catch((err) => {
                  if (err instanceof GaxiosError && err.status === 404) {
                    // Just ignore 404 errors because we loop over all calendars
                    // without checking if the event exists in the calendar
                  } else this.logger.error(err)
                })
              }
            }

            await this.updateEventFromScheduleMessage(scheduleMessage, calendar.id).catch((err) => {
              if (err instanceof GaxiosError && err.status === 404) {
                // Just ignore 404 errors because we loop over all calendars
                // If it should exist, it will be created
                if (calendar.summary && calendar.summary.startsWith(`${this.CALENDAR_PREFIX} - User:`)) {
                  const username = calendar.summary.split(' - User: ')[1]
                  this.addEventToUserCalendar(scheduleMessage, username).catch((err) => {
                    this.logger.error(err)
                  })
                }
              } else this.logger.error(err)
            })
          }
        })
      }
      return
    }

    const updatedEvent: void | GaxiosResponse<calendar_v3.Schema$Event> = await gcal.events
      .update({
        calendarId,
        eventId: scheduleMessage.id,
        requestBody: resource,
      })
      .catch((err: any) => {
        if (err instanceof GaxiosError && err.status === 404) {
          // Event does not exist
          this.logger.debug(`Event ${scheduleMessage.calendarEvent?.title} does not exist. on calendar ${calendarId}.`)
          return
        } else {
          this.logger.error(err)
          return
        }
      })
    if (!updatedEvent) {
      return
    }
    this.logger.debug(`Event ${updatedEvent?.data?.summary} updated: ${updatedEvent?.data?.htmlLink}`)
    return updatedEvent
  }

  async addEventToUserCalendar(scheduleMessage: ScheduleMessage, username: string) {
    // Get the user calendar ID
    const userCalendarId: string | null | undefined = (await this.checkUserCalendar(username))?.id
    if (!userCalendarId) {
      throw new Error(`Could not retrieve ${username} calendar ID.`)
    }

    // Create the event
    return await this.createEventFromScheduleMessage(scheduleMessage, userCalendarId)
  }

  async removeEventFromUserCalendar(scheduleMessage: ScheduleMessage, username: string) {
    // Get the user calendar ID
    const userCalendarId: string | null | undefined = (await this.checkUserCalendar(username))?.id
    if (!userCalendarId) {
      throw new Error(`Could not retrieve ${username} calendar ID.`)
    }

    // Delete the event
    return await this.deleteEvent(scheduleMessage.id, userCalendarId)
  }

  async checkUserCalendar(username: string): Promise<calendar_v3.Schema$Calendar | void> {
    const calendars: void | calendar_v3.Schema$CalendarList = await this.listCalendars()
    if (calendars && calendars.items && calendars.items.length > 0) {
      let userCalendar: calendar_v3.Schema$Calendar | void = calendars.items.find((calendar) => {
        return calendar.summary === `${this.CALENDAR_PREFIX} - User: ${username}`
      })
      if (!userCalendar) {
        userCalendar = await this.createUserCalendar(username)
      }
      if (userCalendar && userCalendar.id) {
        this.CALENDAR_IDS[username] = userCalendar.id
        return userCalendar
      }
    }
  }

  async deleteEvent(eventId: string, calendarId?: string): Promise<void> {
    if (!calendarId) {
      // remove event from all calendars
      const calendarList = await this.listCalendars()
      if (calendarList && calendarList.items) {
        calendarList.items.forEach(async (event) => {
          if (event.id) {
            await this.deleteEvent(eventId, event.id).catch((err) => {
              if ((err instanceof GaxiosError && err.status === 404) || err.status === 409) {
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
    const calendar: calendar_v3.Calendar = google.calendar({ version: 'v3', auth: this.CLIENT })

    // Delete the event
    await calendar.events
      .delete({
        calendarId,
        eventId,
      })
      .catch((err: any) => {
        if ((err instanceof GaxiosError && err.status === 404) || err.status === 409) {
          // Just ignore 404 errors because we loop over all calendars
          // without checking if the event exists in the calendar
        } else this.logger.error(err)
      })
    this.logger.debug(`Event ${eventId} deleted.`)
  }
}
